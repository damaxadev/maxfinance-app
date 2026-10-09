// Diagnóstico de UNA SOLA LECTURA, sin escribir nada: ¿hay settlements
// (abonos) cuyas allocations[].movementId apuntan a un movement que ya no
// existe? Puede pasar si alguien borró un gasto compartido que ya tenía
// abonos aplicados (MovementsService.removeShared() nunca tocó
// settlements — ver DATABASE.md, "Balance de grupo y abonos"). computeDebts()
// ya lo tolera (ignora la allocation huérfana, no rompe pantalla), así que
// esto es solo para saber si existe el caso, no para arreglarlo.
//
// Nunca escribe ni borra nada — no tiene flag --apply a propósito.
//
// Cómo correrlo (mismos requisitos que seed-categories.mjs/
// backfill-shared-expense-category.mjs):
//   1. Credenciales de administrador: `gcloud auth application-default
//      login`, o GOOGLE_APPLICATION_CREDENTIALS apuntando a una clave de
//      cuenta de servicio con rol de lector de Firestore (o Owner/Editor).
//   2. node scripts/diagnose-orphaned-allocations.mjs

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'maxfinance-app';

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const firestore = getFirestore();

async function main() {
  const [settlementsSnap, movementsSnap] = await Promise.all([
    firestore.collection('settlements').get(),
    firestore.collection('movements').get(),
  ]);

  const existingMovementIds = new Set(movementsSnap.docs.map((doc) => doc.id));

  let settlementsWithAllocations = 0;
  let totalAllocations = 0;
  const orphans = [];

  for (const settlementDoc of settlementsSnap.docs) {
    const data = settlementDoc.data();
    const allocations = data.allocations;
    if (!Array.isArray(allocations) || allocations.length === 0) {
      continue;
    }
    settlementsWithAllocations += 1;
    totalAllocations += allocations.length;

    for (const allocation of allocations) {
      if (!existingMovementIds.has(allocation.movementId)) {
        orphans.push({
          settlementId: settlementDoc.id,
          groupId: data.groupId,
          fromUid: data.fromUid,
          toUid: data.toUid,
          status: data.status ?? 'active',
          movementId: allocation.movementId,
          debtorUid: allocation.debtorUid,
          installmentIndex: allocation.installmentIndex,
          amount: allocation.amount,
        });
      }
    }
  }

  console.log(`settlements totales: ${settlementsSnap.size}`);
  console.log(`settlements con allocations (no legacy): ${settlementsWithAllocations}`);
  console.log(`allocations totales revisadas: ${totalAllocations}`);
  console.log(`movements totales: ${movementsSnap.size}`);
  console.log('');

  if (orphans.length === 0) {
    console.log('No se encontraron allocations huérfanas. Todo bien.');
    return;
  }

  console.log(`⚠ ${orphans.length} allocation(s) apuntan a un movement que ya no existe:\n`);
  for (const orphan of orphans) {
    console.log(
      `  settlement ${orphan.settlementId} (grupo ${orphan.groupId}, ${orphan.fromUid} -> ${orphan.toUid}, status=${orphan.status}) ` +
        `-> movement ${orphan.movementId} (deudor ${orphan.debtorUid}, cuota ${orphan.installmentIndex ?? 'N/A'}, $${orphan.amount})`
    );
  }
}

main().catch((error) => {
  console.error('Error al diagnosticar allocations huérfanas:', error);
  process.exitCode = 1;
});
