// Siembra las categorías base (uid: null) de MaxFinance en Firestore.
//
// Corre UNA sola vez (es idempotente: si una categoría base con el mismo
// nombre ya existe, se salta). Usa el Admin SDK, así que no está sujeto a
// las reglas de seguridad de Firestore (que bloquean crear categorías con
// uid: null desde el cliente, a propósito).
//
// Cómo correrlo:
//   1. Necesitas credenciales de administrador para el proyecto Firebase.
//      La forma más simple: `gcloud auth application-default login` (si
//      tienes gcloud CLI y acceso al proyecto), o descarga una clave de
//      cuenta de servicio desde Firebase Console > Configuración del
//      proyecto > Cuentas de servicio > Generar nueva clave privada, y
//      apunta GOOGLE_APPLICATION_CREDENTIALS a ese archivo .json.
//   2. node scripts/seed-categories.mjs

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'maxfinance-app';

const BASE_CATEGORIES = [
  { name: 'Comida', icon: '🍔', type: 'expense' },
  { name: 'Transporte', icon: '🚌', type: 'expense' },
  { name: 'Servicios', icon: '💡', type: 'expense' },
  { name: 'Entretenimiento', icon: '🎬', type: 'expense' },
  { name: 'Salud', icon: '🏥', type: 'expense' },
  { name: 'Hogar', icon: '🏠', type: 'expense' },
  { name: 'Educación', icon: '📚', type: 'expense' },
  { name: 'Ropa', icon: '👕', type: 'expense' },
  { name: 'Salario', icon: '💼', type: 'income' },
  { name: 'Otros ingresos', icon: '💰', type: 'income' },
  // Fase 5: usada al convertir un settlement en movimiento personal cuando
  // quien lo registra es fromUid (el que pagó) — ver DATABASE.md.
  { name: 'Pago de deuda', icon: '💳', type: 'expense' },
];

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const firestore = getFirestore();
  const categoriesRef = firestore.collection('categories');

  const existing = await categoriesRef.where('uid', '==', null).get();
  const existingNames = new Set(existing.docs.map((doc) => doc.data().name));

  let created = 0;
  for (const category of BASE_CATEGORIES) {
    if (existingNames.has(category.name)) {
      console.log(`- Ya existe, se salta: ${category.icon} ${category.name}`);
      continue;
    }
    await categoriesRef.add({ uid: null, ...category });
    console.log(`+ Creada: ${category.icon} ${category.name}`);
    created += 1;
  }

  console.log(`\nListo. ${created} categoría(s) nueva(s) creada(s), ${BASE_CATEGORIES.length - created} ya existían.`);
}

main().catch((error) => {
  console.error('Error al sembrar categorías:', error);
  process.exitCode = 1;
});
