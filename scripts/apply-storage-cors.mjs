// Aplica cors.json (raíz del proyecto) al bucket de Cloud Storage — de uso
// único, para no exigir instalar el SDK completo de Google Cloud (gsutil/
// gcloud) solo para esto. Ver el comentario de cors.json para qué cubre
// cada campo y por qué (preflight de uploadBytes()/getDownloadURL()/
// deleteObject() desde la app nativa — Capacitor en https://localhost — y
// desde `ng serve` en http://localhost:4200).
//
// Idempotente: solo reemplaza la configuración CORS del bucket por la que
// haya en cors.json en ese momento — correrlo varias veces es inofensivo.
//
// Cómo correrlo (mismas credenciales que backfill-shared-expense-category.mjs):
//   1. `gcloud auth application-default login`, o GOOGLE_APPLICATION_CREDENTIALS
//      apuntando a una clave de cuenta de servicio.
//   2. node scripts/apply-storage-cors.mjs

import { readFileSync } from 'node:fs';
import { Storage } from '@google-cloud/storage';

const PROJECT_ID = 'maxfinance-app';
const BUCKET_NAME = 'maxfinance-app.firebasestorage.app';
const CORS_JSON_URL = new URL('../cors.json', import.meta.url);

function printCors(label, cors) {
  console.log(label);
  console.log(cors && cors.length > 0 ? JSON.stringify(cors, null, 2) : '  (sin configuración CORS)');
  console.log('');
}

async function main() {
  const corsConfiguration = JSON.parse(readFileSync(CORS_JSON_URL, 'utf8'));

  const storage = new Storage({ projectId: PROJECT_ID });
  const bucket = storage.bucket(BUCKET_NAME);

  const [before] = await bucket.getMetadata();
  printCors('CORS actual del bucket (antes):', before.cors);

  await bucket.setCorsConfiguration(corsConfiguration);

  const [after] = await bucket.getMetadata();
  printCors('CORS del bucket (después de aplicar):', after.cors);

  console.log('Listo.');
}

main().catch((error) => {
  console.error('Error aplicando la configuración CORS:', error);
  process.exitCode = 1;
});
