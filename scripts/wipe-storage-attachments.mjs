// Borra los adjuntos (fotos/PDF de recibos) del bucket de Cloud Storage — de
// uso único, para el reset de datos de prueba. Mismo patrón que
// apply-storage-cors.mjs: usa @google-cloud/storage directo, sin gsutil.
//
// Por defecto corre en modo DRY-RUN: lista las carpetas de primer nivel del
// bucket con su conteo de archivos y no borra nada. Pasa --apply para borrar
// SOLO las carpetas de adjuntos conocidas (movements/, goalEntries/). Cualquier
// otra carpeta se muestra pero se deja intacta, salvo que pases --all (que
// borra TODO el bucket).
//
// Orden recomendado del reset (ver conversación):
//   1. node scripts/wipe-storage-attachments.mjs --apply
//   2. firebase firestore:delete --all-collections --project maxfinance-app
//   3. node scripts/seed-categories.mjs
//
// Credenciales: GOOGLE_APPLICATION_CREDENTIALS apuntando al JSON de una
// cuenta de servicio con rol Storage Admin (roles/storage.admin).

import { Storage } from '@google-cloud/storage';

const PROJECT_ID = 'maxfinance-app';
const BUCKET_NAME = 'maxfinance-app.firebasestorage.app';
// Único lugar donde la app escribe adjuntos (ver MovementsService.attachFile()
// y GoalEntriesService.attachFile()). Si se agrega otro, va acá.
const ATTACHMENT_PREFIXES = ['movements/', 'goalEntries/'];
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

const storage = new Storage({ projectId: PROJECT_ID });
const bucket = storage.bucket(BUCKET_NAME);

function topLevelFolder(fileName) {
  const slash = fileName.indexOf('/');
  return slash === -1 ? '(raiz)' : fileName.slice(0, slash + 1);
}

async function countTopLevelFolders() {
  const [files] = await bucket.getFiles();
  const counts = new Map();
  for (const file of files) {
    const folder = topLevelFolder(file.name);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return counts;
}

async function main() {
  const counts = await countTopLevelFolders();

  if (counts.size === 0) {
    console.log('El bucket está vacío. Nada que borrar.');
    return;
  }

  console.log(`Bucket: ${BUCKET_NAME}\n`);
  console.log('Carpetas de primer nivel:');
  for (const [folder, count] of counts) {
    const isAttachment = ATTACHMENT_PREFIXES.includes(folder);
    const status = ALL || isAttachment ? 'se borra' : 'se deja intacta';
    console.log(`  ${folder.padEnd(20)} ${String(count).padStart(6)} archivo(s)  → ${status}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('Modo dry-run: no se borró nada. Revisa la lista de arriba.');
    console.log('Si todo se ve bien, corre de nuevo con --apply.');
    return;
  }

  if (ALL) {
    await bucket.deleteFiles({ force: true });
    console.log('Borrado TODO el bucket (--all).');
  } else {
    for (const prefix of ATTACHMENT_PREFIXES) {
      if (!counts.has(prefix)) {
        console.log(`- ${prefix} no existe en el bucket, se salta.`);
        continue;
      }
      await bucket.deleteFiles({ prefix, force: true });
      console.log(`+ Borrado ${prefix}`);
    }
  }

  const remaining = await countTopLevelFolders();
  console.log('\nEstado después de borrar:');
  if (remaining.size === 0) {
    console.log('  (bucket vacío)');
  } else {
    for (const [folder, count] of remaining) {
      console.log(`  ${folder.padEnd(20)} ${String(count).padStart(6)} archivo(s)`);
    }
  }
}

main().catch((error) => {
  console.error('Error al borrar adjuntos de Storage:', error);
  process.exitCode = 1;
});
