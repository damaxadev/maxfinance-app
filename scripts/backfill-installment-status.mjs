// Corrige installments[i].status en movements cuyo valor quedó
// desincronizado del balance real (ver DATABASE.md, "Balance de grupo y
// abonos") — típicamente gastos a cuotas donde una cuota quedó pagada por
// un camino que no pasó por payInstallment (p. ej. "Marcar como saldada"
// antes de que existiera el trigger syncInstallmentStatus, o cualquier
// abono creado/anulado mientras ese trigger estaba desplegándose). Una vez
// que syncInstallmentStatus está desplegado, los abonos NUEVOS se
// mantienen sincronizados solos — este script es solo para arreglar lo que
// quedó mal ANTES de eso.
//
// Mismo algoritmo que core/debts/debts.ts / functions/src/debts.ts,
// duplicado a mano una tercera vez a propósito: este es un script de un
// solo uso en JS plano (no TypeScript, no puede importar esos módulos sin
// un paso de build), igual que backfill-shared-expense-category.mjs. Si
// cambia la lógica de deudas, este script queda obsoleto — no se mantiene
// después de usarlo.
//
// Por defecto corre en modo DRY-RUN: no escribe nada, solo lista qué
// movimientos/cuotas tocaría. Pasa --apply para escribir de verdad.
//
// Cómo correrlo (mismos requisitos que seed-categories.mjs):
//   1. Credenciales de administrador: `gcloud auth application-default
//      login`, o GOOGLE_APPLICATION_CREDENTIALS apuntando a una clave de
//      cuenta de servicio.
//   2. node scripts/backfill-installment-status.mjs          (dry-run)
//      node scripts/backfill-installment-status.mjs --apply  (escribe)

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'maxfinance-app';
const APPLY = process.argv.includes('--apply');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const firestore = getFirestore();

function toCents(amount) {
  return Math.round(amount * 100);
}

// Mismo núcleo que computeAllDebts() en functions/src/debts.ts.
function computeAllDebts(movements, settlements) {
  const raw = [];
  for (const movement of movements) {
    if (movement.installments?.length) {
      const debtorUid = movement.splits.find((split) => split.uid !== movement.paidBy)?.uid;
      if (!debtorUid) continue;
      movement.installments.forEach((installment, index) => {
        raw.push({
          movementId: movement.id,
          debtorUid,
          creditorUid: movement.paidBy,
          installmentIndex: index,
          totalCents: toCents(installment.amount),
          paidCents: 0,
          orderKey: installment.dueDate.toMillis(),
        });
      });
      continue;
    }
    for (const split of movement.splits ?? []) {
      if (split.uid === movement.paidBy) continue;
      raw.push({
        movementId: movement.id,
        debtorUid: split.uid,
        creditorUid: movement.paidBy,
        installmentIndex: null,
        totalCents: toCents(split.amount),
        paidCents: 0,
        orderKey: movement.date.toMillis(),
      });
    }
  }
  raw.sort((a, b) => a.orderKey - b.orderKey);

  const byKey = new Map(raw.map((d) => [`${d.movementId}::${d.debtorUid}::${d.installmentIndex ?? '-'}`, d]));
  const active = settlements.filter((s) => s.status !== 'voided');

  for (const settlement of active) {
    if (!settlement.allocations?.length) continue;
    for (const allocation of settlement.allocations) {
      const debt = byKey.get(`${allocation.movementId}::${allocation.debtorUid}::${allocation.installmentIndex ?? '-'}`);
      if (debt) debt.paidCents += toCents(allocation.amount);
    }
  }

  const legacy = active.filter((s) => !s.allocations?.length).sort((a, b) => a.date.toMillis() - b.date.toMillis());
  for (const settlement of legacy) {
    let remainingCents = toCents(settlement.amount);
    if (remainingCents <= 0) continue;
    for (const debt of raw) {
      if (remainingCents <= 0) break;
      if (debt.debtorUid !== settlement.fromUid || debt.creditorUid !== settlement.toUid) continue;
      const debtRemaining = debt.totalCents - debt.paidCents;
      if (debtRemaining <= 0) continue;
      const applied = Math.min(debtRemaining, remainingCents);
      debt.paidCents += applied;
      remainingCents -= applied;
    }
  }

  return raw.map((d) => ({
    movementId: d.movementId,
    installmentIndex: d.installmentIndex,
    remaining: (d.totalCents - Math.min(d.paidCents, d.totalCents)) / 100,
  }));
}

async function main() {
  const [movementsSnap, settlementsSnap] = await Promise.all([
    firestore.collection('movements').get(),
    firestore.collection('settlements').get(),
  ]);

  const movementsByGroup = new Map();
  const movementDocById = new Map();
  for (const doc of movementsSnap.docs) {
    const data = doc.data();
    if (!data.groupId || !Array.isArray(data.installments) || data.installments.length === 0) {
      continue; // solo nos importan los gastos a cuotas.
    }
    movementDocById.set(doc.id, doc);
    const list = movementsByGroup.get(data.groupId) ?? [];
    list.push({ id: doc.id, date: data.date, paidBy: data.paidBy, splits: data.splits ?? [], installments: data.installments });
    movementsByGroup.set(data.groupId, list);
  }

  const settlementsByGroup = new Map();
  for (const doc of settlementsSnap.docs) {
    const data = doc.data();
    const list = settlementsByGroup.get(data.groupId) ?? [];
    list.push(data);
    settlementsByGroup.set(data.groupId, list);
  }

  let fixedMovements = 0;
  let fixedInstallments = 0;

  for (const [groupId, movements] of movementsByGroup) {
    const settlements = settlementsByGroup.get(groupId) ?? [];
    const debts = computeAllDebts(movements, settlements);
    const debtsByMovementId = new Map();
    for (const debt of debts) {
      if (debt.installmentIndex === null) continue;
      const list = debtsByMovementId.get(debt.movementId) ?? [];
      list.push(debt);
      debtsByMovementId.set(debt.movementId, list);
    }

    for (const movement of movements) {
      const movementDebts = debtsByMovementId.get(movement.id) ?? [];
      let changed = false;
      const nextInstallments = movement.installments.map((installment, index) => {
        const debt = movementDebts.find((d) => d.installmentIndex === index);
        if (!debt) return installment;
        const nextStatus = debt.remaining <= 0 ? 'paid' : 'pending';
        if (installment.status === nextStatus) return installment;
        changed = true;
        console.log(
          `  movement ${movement.id} (grupo ${groupId}) cuota ${index}: '${installment.status}' -> '${nextStatus}' (remaining=${debt.remaining})`
        );
        return { ...installment, status: nextStatus };
      });

      if (!changed) continue;
      fixedMovements += 1;
      fixedInstallments += nextInstallments.filter((inst, i) => inst.status !== movement.installments[i].status).length;

      if (APPLY) {
        const stillPending = nextInstallments.some((inst) => inst.status === 'pending');
        await movementDocById.get(movement.id).ref.update({ installments: nextInstallments, hasPendingInstallments: stillPending });
      }
    }
  }

  console.log('');
  console.log(`movements con cuotas revisados: ${movementDocById.size}`);
  console.log(`movements a corregir: ${fixedMovements} (${fixedInstallments} cuota(s))`);
  if (fixedMovements === 0) {
    console.log('Todo sincronizado. Nada que corregir.');
  } else if (!APPLY) {
    console.log('Modo dry-run: no se escribió nada. Si todo se ve bien, corre de nuevo con --apply.');
  } else {
    console.log('Escrito.');
  }
}

main().catch((error) => {
  console.error('Error al corregir installments[].status:', error);
  process.exitCode = 1;
});
