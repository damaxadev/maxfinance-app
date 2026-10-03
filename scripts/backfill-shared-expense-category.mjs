// Backfill de una sola vez: gastos compartidos (movements con paidBy/
// splitType/splits, ver models/movement.model.ts SharedMovement) creados
// ANTES de la denormalización de categoría (ver DATABASE.md, "Categoría
// denormalizada en gastos compartidos") no tienen categoryName/categoryIcon
// guardado. Si su categoryId apunta a una categoría PERSONALIZADA
// (uid != null, no una categoría base del sistema — esas ya se resuelven
// bien en vivo para cualquier usuario), se rellenan esos dos campos
// leyendo esa categoría directo por su id, sin filtrar por usuario — válido
// solo en este script de un solo uso vía Admin SDK (bypassa las reglas de
// Firestore, igual que seed-categories.mjs).
//
// Es idempotente: una vez backfillado, categoryName deja de ser `undefined`
// (incluso si quedó en `null` por alguna razón), así que una segunda
// corrida no vuelve a tocar esos documentos.
//
// Por defecto corre en modo DRY-RUN: no escribe nada, solo muestra cuántos
// documentos tocaría y un ejemplo de antes/después. Pasa --apply para
// escribir de verdad.
//
// Cómo correrlo (mismos requisitos que seed-categories.mjs):
//   1. Credenciales de administrador: `gcloud auth application-default
//      login`, o GOOGLE_APPLICATION_CREDENTIALS apuntando a una clave de
//      cuenta de servicio.
//   2. node scripts/backfill-shared-expense-category.mjs          (dry-run)
//      node scripts/backfill-shared-expense-category.mjs --apply  (escribe)

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'maxfinance-app';
const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500; // límite de Firestore por batch.

function isSharedMovement(data) {
  // Distingue un SharedMovement real de un PersonalMovement etiquetado a un
  // grupo (groupId también no-null ahí, pero nunca lleva estos 3 campos) —
  // ver el comentario de PersonalMovement.groupId en movement.model.ts.
  return !!data.groupId && data.paidBy !== undefined && data.splitType !== undefined && Array.isArray(data.splits);
}

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const firestore = getFirestore();

  const categoriesSnapshot = await firestore.collection('categories').get();
  const categoriesById = new Map(categoriesSnapshot.docs.map((doc) => [doc.id, doc.data()]));

  const movementsSnapshot = await firestore.collection('movements').get();

  const candidates = [];
  for (const doc of movementsSnapshot.docs) {
    const data = doc.data();
    if (!isSharedMovement(data)) continue;
    if (data.categoryName !== undefined) continue; // ya tiene el campo (string o null) — ya pasó por el código nuevo.
    if (!data.categoryId) continue; // sin categoría, nada que backfillear.

    const category = categoriesById.get(data.categoryId);
    if (!category || category.uid === null) continue; // eliminada, o es categoría base (ya se resuelve bien en vivo).

    candidates.push({ id: doc.id, data, category });
  }

  console.log(`${candidates.length} gasto(s) compartido(s) para actualizar.\n`);

  if (candidates.length === 0) {
    console.log('Nada que hacer.');
    return;
  }

  const [example] = candidates;
  console.log('Ejemplo:');
  console.log(`  movements/${example.id}`);
  console.log(
    `  antes:   categoryId=${example.data.categoryId}, categoryName=(ausente), categoryIcon=(ausente)`
  );
  console.log(
    `  después: categoryId=${example.data.categoryId}, categoryName=${example.category.name}, categoryIcon=${example.category.icon}\n`
  );

  if (!APPLY) {
    console.log('Modo dry-run (no se escribió nada). Revisa el conteo y el ejemplo de arriba.');
    console.log('Si todo se ve bien, corre de nuevo con --apply para escribir los cambios de verdad.');
    return;
  }

  let batch = firestore.batch();
  let opsInBatch = 0;
  let updated = 0;
  for (const { id, category } of candidates) {
    batch.update(firestore.collection('movements').doc(id), {
      categoryName: category.name,
      categoryIcon: category.icon,
    });
    opsInBatch += 1;
    updated += 1;
    if (opsInBatch === BATCH_SIZE) {
      await batch.commit();
      batch = firestore.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) {
    await batch.commit();
  }

  console.log(`Listo. ${updated} gasto(s) compartido(s) actualizado(s).`);
}

main().catch((error) => {
  console.error('Error en el backfill de categoría denormalizada:', error);
  process.exitCode = 1;
});
