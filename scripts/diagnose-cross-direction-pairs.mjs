// Diagnóstico de UNA SOLA LECTURA, sin escribir nada: ¿hay parejas donde
// pasar del modelo viejo (neto por pareja, con cruce) al nuevo (una línea
// por DIRECCIÓN, sin cruce — ver DATABASE.md, "Balance de grupo y abonos")
// cambia lo que se ve?
//
// Solo puede pasar en una pareja con deuda en LOS DOS sentidos a la vez
// (remaining > 0 en A->B Y en B->A): con neto, eso se simplificaba a una
// sola línea (o a cero, si coincidían) — típicamente porque alguien marcó
// "saldada" bajo el modelo viejo y ese abono legacy (sin allocations) solo
// pudo reducir SU dirección, nunca la contraria (computeDebts() ya
// reparte los abonos legacy por dirección, no por pareja — ver
// core/debts/debts.ts). Sin cruce, esas dos direcciones se ven ambas,
// completas.
//
// Nunca escribe ni borra nada — no tiene flag --apply a propósito.
//
// Cómo correrlo (mismos requisitos que seed-categories.mjs):
//   1. Credenciales de administrador: `gcloud auth application-default
//      login`, o GOOGLE_APPLICATION_CREDENTIALS apuntando a una clave de
//      cuenta de servicio.
//   2. node scripts/diagnose-cross-direction-pairs.mjs

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'maxfinance-app';

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const firestore = getFirestore();

function toCents(amount) {
  return Math.round(amount * 100);
}

// Mismo núcleo que computeAllDebts() en functions/src/debts.ts /
// computeDebts() en core/debts/debts.ts — portado a JS plano una vez más
// a propósito (ver el comentario de cabecera de esos dos archivos: tres
// copias es el patrón ya establecido para los scripts de un solo uso).
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
    debtorUid: d.debtorUid,
    creditorUid: d.creditorUid,
    remaining: (d.totalCents - Math.min(d.paidCents, d.totalCents)) / 100,
  }));
}

async function main() {
  const [groupsSnap, movementsSnap, settlementsSnap] = await Promise.all([
    firestore.collection('groups').get(),
    firestore.collection('movements').get(),
    firestore.collection('settlements').get(),
  ]);

  const groupNameById = new Map(groupsSnap.docs.map((doc) => [doc.id, doc.data().name ?? doc.id]));

  const movementsByGroup = new Map();
  for (const doc of movementsSnap.docs) {
    const data = doc.data();
    if (!data.groupId || !data.paidBy || !Array.isArray(data.splits)) continue; // solo gastos compartidos.
    const list = movementsByGroup.get(data.groupId) ?? [];
    list.push({ id: doc.id, date: data.date, paidBy: data.paidBy, splits: data.splits, installments: data.installments });
    movementsByGroup.set(data.groupId, list);
  }

  const settlementsByGroup = new Map();
  for (const doc of settlementsSnap.docs) {
    const data = doc.data();
    const list = settlementsByGroup.get(data.groupId) ?? [];
    list.push(data);
    settlementsByGroup.set(data.groupId, list);
  }

  const affected = [];

  for (const [groupId, movements] of movementsByGroup) {
    const settlements = settlementsByGroup.get(groupId) ?? [];
    const debts = computeAllDebts(movements, settlements);

    const totalsByDirection = new Map(); // "a|b" -> centavos
    for (const debt of debts) {
      if (debt.remaining <= 0) continue;
      const key = `${debt.debtorUid}|${debt.creditorUid}`;
      totalsByDirection.set(key, (totalsByDirection.get(key) ?? 0) + toCents(debt.remaining));
    }

    const seenPairs = new Set();
    for (const [key] of totalsByDirection) {
      const [a, b] = key.split('|');
      const pairKey = [a, b].sort().join('|');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const abCents = totalsByDirection.get(`${a}|${b}`) ?? 0;
      const baCents = totalsByDirection.get(`${b}|${a}`) ?? 0;
      if (abCents > 0 && baCents > 0) {
        affected.push({
          groupId,
          groupName: groupNameById.get(groupId) ?? groupId,
          uidA: a,
          uidB: b,
          aOwesB: abCents / 100,
          bOwesA: baCents / 100,
          oldNet: Math.abs(abCents - baCents) / 100,
          oldNetDirection: abCents > baCents ? `${a} -> ${b}` : abCents < baCents ? `${b} -> ${a}` : 'saldado (0)',
        });
      }
    }
  }

  console.log(`grupos con gastos compartidos revisados: ${movementsByGroup.size}`);
  console.log('');

  if (affected.length === 0) {
    console.log('No se encontraron parejas con deuda en los dos sentidos a la vez. El cambio al modelo sin cruce no afecta a nadie.');
    return;
  }

  console.log(`⚠ ${affected.length} pareja(s) donde el modelo sin cruce muestra algo distinto al neto viejo:\n`);
  for (const item of affected) {
    console.log(`  grupo "${item.groupName}" (${item.groupId}):`);
    console.log(`    ${item.uidA} le debe a ${item.uidB}: $${item.aOwesB.toLocaleString('es-CO')}`);
    console.log(`    ${item.uidB} le debe a ${item.uidA}: $${item.bOwesA.toLocaleString('es-CO')}`);
    console.log(`    (con el modelo viejo se veía solo: ${item.oldNetDirection}${item.oldNet > 0 ? ` $${item.oldNet.toLocaleString('es-CO')}` : ''})`);
    console.log('');
  }
}

main().catch((error) => {
  console.error('Error al diagnosticar parejas con cruce:', error);
  process.exitCode = 1;
});
