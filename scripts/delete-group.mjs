// Borra un grupo COMPLETO directo en Firestore/Storage (Admin SDK) — para
// limpiar datos de prueba que GroupsService.remove() rechaza a propósito
// (bloquea si el grupo tiene movements/settlements/goalEntries, ver
// core/groups/groups.ts). Mismo patrón que wipe-storage-attachments.mjs/
// backfill-installment-status.mjs: DRY-RUN por defecto, --apply para
// escribir, de uso único (no se mantiene después de usarlo).
//
// Uso:
//   node scripts/delete-group.mjs
//     Sin flags: lista TODOS los grupos (id, nombre, miembros, conteo de
//     movements/settlements/goalEntries/recurringPayments). Nunca borra.
//
//   node scripts/delete-group.mjs --group <groupId>
//     Dry-run de un grupo puntual: reporta exactamente qué borraría.
//
//   node scripts/delete-group.mjs --group <groupId> --apply --confirm "<nombre exacto del grupo>"
//     Borra de verdad. --confirm tiene que coincidir EXACTO con el nombre
//     actual del grupo (si no, aborta sin tocar nada) y además pide un
//     y/N interactivo antes de escribir.
//
//   Agrega --include-linked para además borrar los movements PERSONALES
//   (de cualquier usuario) vinculados a un settlement de este grupo vía
//   settlementId — por defecto esos NO se tocan, solo se reportan.
//
//   Agrega --revert-balances (solo escribe junto con --apply; sin --apply
//   igual muestra en el dry-run qué ajustaría) para revertir el saldo de
//   cuenta de cada movement DEL GRUPO con accountId — el inverso exacto de
//   MovementsService.removeShared() (balance += movement.amount, ver
//   aggregateAccountDeltas() más abajo para el por qué). NO cubre los
//   movements "linked" de --include-linked — ver el aviso que imprime el
//   reporte para esos, igual que siempre quedan fuera.
//
//   Agrega --backup-dir <ruta> para cambiar dónde se guarda el respaldo
//   (por defecto, la carpeta personal del usuario — ver BACKUP_DIR abajo,
//   siempre FUERA de este repo).
//
// Atomicidad y seguridad ante un corte a mitad de camino (ver
// deleteMovementsAtomically() más abajo): cada movement se borra y su
// reversión de saldo se aplica en la MISMA transacción de Firestore (hasta
// 250 movements por transacción, <= 500 ops) — nunca un incremento
// agregado por cuenta aparte del borrado. Si el proceso muere entre
// transacciones, volver a correr el script es seguro: los movements de
// una transacción ya comprometida ya no existen, así que una relectura
// solo encuentra (y solo reprocesa) los que quedaron pendientes — nunca
// se duplica ni se pierde una reversión, sin necesitar un log de progreso
// aparte (el propio estado de Firestore ya lo es).
//
// Respaldo ANTES de escribir nada (ver writeBackupFile()): con --apply,
// antes de tocar Storage o Firestore, guarda un JSON fuera del repo con
// los movements a borrar (id/accountId/amount/type), el saldo de cada
// cuenta tocada ANTES del cambio, y la fecha/hora — si algo sale mal, ese
// archivo alcanza para reconstruir los saldos a mano. Si el respaldo
// falla al escribirse, el script aborta sin tocar nada.
//
// Qué borra (con --apply): los adjuntos en Storage de movements/
// goalEntries/settlements de este grupo, luego goalEntries, recurringPayments,
// movements y settlements con ese groupId (en ESE orden — ver el comentario
// de deleteGroup() más abajo sobre por qué movements va ANTES que
// settlements), y por último el doc del grupo.
//
// Qué NO revierte nunca, ni con --revert-balances (ver el reporte, sección
// "linked"): borrar un movement PERSONAL vinculado (--include-linked) no
// deshace el increment()/decrement() que se le aplicó a su cuenta al
// crearlo (ver SettlementsService.appendLinkedMovement()) — el saldo de
// esa cuenta queda desincronizado y hay que ajustarlo a mano.
//
// Credenciales: `gcloud auth application-default login`, o
// GOOGLE_APPLICATION_CREDENTIALS apuntando a una clave de cuenta de
// servicio con rol de Firestore + Storage Admin (mismo requisito que
// backfill-installment-status.mjs/apply-storage-cors.mjs).

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PROJECT_ID = 'maxfinance-app';
const BUCKET_NAME = 'maxfinance-app.firebasestorage.app';
const APPLY = process.argv.includes('--apply');
const INCLUDE_LINKED = process.argv.includes('--include-linked');
// Revierte el saldo de cuenta de cada movement del GRUPO (nunca de los
// "linked" personales de --include-linked, esos quedan fuera a propósito,
// igual que siempre — ver el aviso que ya imprime printReport() para
// esos). Solo escribe de verdad junto con --apply; sin --apply, el
// dry-run de todos modos muestra el ajuste que se aplicaría.
const REVERT_BALANCES = process.argv.includes('--revert-balances');

function flagValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}
const GROUP_ID = flagValue('--group');
const CONFIRM_NAME = flagValue('--confirm');
// FUERA del repo a propósito (ver writeBackupFile() más abajo) — el
// default es la carpeta personal del usuario, nunca algo bajo
// C:\Projects\maxfinance-app. --backup-dir la cambia si ya tienes tu
// propia carpeta de secrets/backups establecida.
const BACKUP_DIR = flagValue('--backup-dir') ?? join(homedir(), 'maxfinance-backups');

// Hasta 2 ops por movement (delete + increment de su cuenta) — 250 por
// chunk mantiene cada transacción en <= 500 ops, el máximo de Firestore.
const DELETE_CHUNK_SIZE = 250;

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID, storageBucket: BUCKET_NAME });
const firestore = getFirestore();
const bucket = getStorage().bucket(BUCKET_NAME);

// Colecciones "dueñas" de un grupo — todo lo que tiene groupId == este
// grupo se borra junto con él (movements/settlements/goalEntries son el
// chequeo que ya hace GroupsService.remove(); recurringPayments NO lo
// chequea hoy — ver RecurringPayment, variante de grupo — así que un
// recurrente de grupo huérfano es un gap preexistente de esa guarda, no de
// este script).
const OWNED_COLLECTIONS = ['movements', 'settlements', 'goalEntries', 'recurringPayments'];

async function countWhere(collectionName, groupId) {
  const snap = await firestore.collection(collectionName).where('groupId', '==', groupId).count().get();
  return snap.data().count;
}

async function listAllGroups() {
  const groupsSnap = await firestore.collection('groups').get();
  if (groupsSnap.empty) {
    console.log('No hay grupos.');
    return;
  }

  console.log(`${groupsSnap.size} grupo(s):\n`);
  for (const doc of groupsSnap.docs) {
    const data = doc.data();
    const counts = await Promise.all(OWNED_COLLECTIONS.map((name) => countWhere(name, doc.id)));
    console.log(`- ${doc.id}  "${data.name}"  (miembros: ${(data.members ?? []).join(', ') || '(ninguno)'})`);
    console.log(
      `    movements=${counts[0]}  settlements=${counts[1]}  goalEntries=${counts[2]}  recurringPayments=${counts[3]}`
    );
  }
}

// Movements PERSONALES (groupId: null, de cualquier usuario) vinculados a
// alguno de estos settlements vía settlementId — ver
// SettlementsService.linkPersonalMovement()/appendLinkedMovement(). 'in'
// acepta hasta 30 valores, por eso el chunking (mismo patrón que
// SettlementsService.findLinkedMovementSettlementIds()).
async function getLinkedMovements(settlementIds) {
  if (settlementIds.length === 0) {
    return [];
  }
  const chunks = [];
  for (let i = 0; i < settlementIds.length; i += 30) {
    chunks.push(settlementIds.slice(i, i + 30));
  }
  const results = await Promise.all(
    chunks.map((ids) => firestore.collection('movements').where('settlementId', 'in', ids).get())
  );
  return results.flatMap((snap) => snap.docs);
}

async function fetchByIds(collectionName, ids) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const refs = uniqueIds.map((id) => firestore.collection(collectionName).doc(id));
  const snaps = await firestore.getAll(...refs);
  return new Map(snaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data()]));
}

function toCents(amount) {
  return Math.round(amount * 100);
}

// INVERSO EXACTO de MovementsService.removeShared(): `balance:
// increment(movement.amount)`, sin importar el tipo de cuenta (efectivo/
// banco/tarjeta — accounts no distingue entre ellas en ningún lado del
// código, el campo balance se trata siempre igual) y SIN mirar
// installments en absoluto. Un gasto a cuotas se paga de la cuenta del
// pagador por el TOTAL del gasto al crearlo (createShared(): increment(
// -value.amount), el monto completo, no por cuota) — las cuotas son
// puramente un plan de cobro de la deuda del otro lado (vía abonos, que
// nunca tocan accounts.balance); revertir por el total es lo correcto en
// los dos casos, pagado o no. Se agrega por cuenta (no un increment por
// movement) para emitir un solo write por cuenta en el BulkWriter.
function aggregateAccountDeltas(movementsSnap) {
  const deltas = new Map(); // accountId -> { amountCents, movementIds }
  for (const doc of movementsSnap.docs) {
    const data = doc.data();
    if (!data.accountId) {
      continue;
    }
    const entry = deltas.get(data.accountId) ?? { amountCents: 0, movementIds: [] };
    entry.amountCents += toCents(data.amount);
    entry.movementIds.push(doc.id);
    deltas.set(data.accountId, entry);
  }
  return deltas;
}

// createShared() solo asigna accountId a la cuenta de quien PAGA Y
// registra el movimiento a la vez (ver su comentario: "la cuenta de otro
// miembro es privada") — si accountId termina apuntando a la cuenta de
// otro uid, es un dato inconsistente que vale la pena mirar antes de
// confiar en el ajuste automático.
function findCrossOwnerMovements(movementsSnap, accountsById) {
  const crossOwner = [];
  for (const doc of movementsSnap.docs) {
    const data = doc.data();
    if (!data.accountId) {
      continue;
    }
    const account = accountsById.get(data.accountId);
    if (account && account.uid !== data.uid) {
      crossOwner.push({ movementId: doc.id, movementUid: data.uid, accountId: data.accountId, accountOwnerUid: account.uid });
    }
  }
  return crossOwner;
}

async function buildReport(groupId) {
  const groupRef = firestore.collection('groups').doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw new Error(`No existe el grupo ${groupId}.`);
  }
  const group = groupSnap.data();

  const [movementsSnap, settlementsSnap, goalEntriesSnap, recurringSnap] = await Promise.all(
    OWNED_COLLECTIONS.map((name) => firestore.collection(name).where('groupId', '==', groupId).get())
  );
  const linkedMovements = await getLinkedMovements(settlementsSnap.docs.map((doc) => doc.id));

  const accountIds = [
    ...movementsSnap.docs.map((doc) => doc.data().accountId),
    ...linkedMovements.map((doc) => doc.data().accountId),
  ];
  const linkedOwnerUids = linkedMovements.map((doc) => doc.data().uid);
  const [accountsById, usersById] = await Promise.all([
    fetchByIds('accounts', accountIds),
    fetchByIds('users', linkedOwnerUids),
  ]);

  const accountDeltas = aggregateAccountDeltas(movementsSnap);
  const crossOwnerMovements = findCrossOwnerMovements(movementsSnap, accountsById);

  return {
    groupId,
    groupRef,
    group,
    movementsSnap,
    settlementsSnap,
    goalEntriesSnap,
    recurringSnap,
    linkedMovements,
    accountsById,
    usersById,
    accountDeltas,
    crossOwnerMovements,
  };
}

function printReport(report) {
  const {
    groupId,
    group,
    movementsSnap,
    settlementsSnap,
    goalEntriesSnap,
    recurringSnap,
    linkedMovements,
    accountsById,
    usersById,
    accountDeltas,
    crossOwnerMovements,
  } = report;

  console.log(`Grupo ${groupId}: "${group.name}"  (miembros: ${(group.members ?? []).join(', ') || '(ninguno)'})\n`);
  console.log('Se borraría (con --apply):');
  console.log(`  movements:          ${movementsSnap.size}`);
  console.log(`  settlements:        ${settlementsSnap.size}`);
  console.log(`  goalEntries:        ${goalEntriesSnap.size}`);
  console.log(`  recurringPayments:  ${recurringSnap.size}`);
  console.log('  + el doc del grupo');
  console.log('  + los adjuntos en Storage de los movements/goalEntries/settlements de arriba (si tienen)\n');

  const movementsWithAccount = movementsSnap.docs.filter((doc) => doc.data().accountId);
  if (movementsWithAccount.length > 0) {
    console.log(
      `⚠ ${movementsWithAccount.length} movement(s) de este grupo tienen accountId — borrarlos NO revierte el saldo de esa cuenta:`
    );
    for (const doc of movementsWithAccount) {
      const data = doc.data();
      const account = accountsById.get(data.accountId);
      console.log(`    ${doc.id}: cuenta "${account?.name ?? data.accountId}" (${account?.type ?? '?'}) — ${data.type} $${data.amount}`);
    }
    console.log('');
  }

  if (linkedMovements.length > 0) {
    console.log(
      `⚠ ${linkedMovements.length} movement(s) PERSONAL(es), de cualquier usuario, están vinculados a un abono de este grupo (settlementId).`
    );
    console.log(`  ${INCLUDE_LINKED ? 'SE BORRARÁN (--include-linked)' : 'NO se borran (falta --include-linked) — solo se reportan'}:`);
    for (const doc of linkedMovements) {
      const data = doc.data();
      const account = accountsById.get(data.accountId);
      const owner = usersById.get(data.uid);
      console.log(
        `    ${doc.id}: dueño ${owner?.displayName ?? data.uid}, cuenta "${account?.name ?? data.accountId}" (${account?.type ?? '?'}) — ${data.type} $${data.amount}`
      );
    }
    console.log(
      '  Borrarlos (si aplica) tampoco revierte el saldo de esas cuentas, ni con --revert-balances (solo cubre los movements del grupo) — ajústalo a mano.\n'
    );
  }

  if (REVERT_BALANCES) {
    printBalanceRevertReport(accountDeltas, accountsById, crossOwnerMovements);
  }
}

function printBalanceRevertReport(accountDeltas, accountsById, crossOwnerMovements) {
  console.log('--revert-balances: ajuste de saldo por cuenta (inverso exacto de removeShared()):');
  if (accountDeltas.size === 0) {
    console.log('  Ningún movement de este grupo tiene accountId — nada que ajustar.\n');
  } else {
    for (const [accountId, { amountCents, movementIds }] of accountDeltas) {
      const account = accountsById.get(accountId);
      const delta = amountCents / 100;
      if (!account) {
        console.log(
          `  ⚠ cuenta ${accountId} ya NO EXISTE — se salta. Se habría sumado $${delta} (de ${movementIds.length} movement(s): ${movementIds.join(', ')}).`
        );
        continue;
      }
      const resulting = Math.round((account.balance + delta) * 100) / 100;
      console.log(
        `  "${account.name}" (${accountId}), dueño ${account.uid}: saldo actual $${account.balance}  +  $${delta} (${movementIds.length} movement(s))  =  $${resulting}`
      );
    }
    console.log('');
  }

  if (crossOwnerMovements.length > 0) {
    console.log(
      `⚠ ${crossOwnerMovements.length} movement(s) cuyo accountId pertenece a un usuario DISTINTO al que registró el movement (uid):`
    );
    for (const c of crossOwnerMovements) {
      console.log(`    movement ${c.movementId}: uid=${c.movementUid}, pero la cuenta ${c.accountId} es de ${c.accountOwnerUid}`);
    }
    console.log('  El ajuste de arriba se aplica igual (el campo balance no distingue dueño) — queda reportado aparte para que lo revises.\n');
  }
}

async function deleteAttachments(prefix, ids) {
  await Promise.all(
    ids.map(async (id) => {
      try {
        await bucket.file(`${prefix}/${id}/attachment`).delete({ ignoreNotFound: true });
      } catch (error) {
        console.error(`  ⚠ No se pudo borrar el adjunto de ${prefix}/${id}:`, error.message);
      }
    })
  );
}

// BulkWriter: auto-batchea y reintenta solo, sin que este script tenga que
// cortar a mano en grupos de 500 (límite de un batch de Firestore).
async function deleteRefs(refs) {
  if (refs.length === 0) {
    return;
  }
  const bulkWriter = firestore.bulkWriter();
  for (const ref of refs) {
    bulkWriter.delete(ref);
  }
  await bulkWriter.close();
}

// Borra los movements del grupo y, con --revert-balances, revierte el
// saldo de cuenta de CADA UNO dentro de la MISMA transacción atómica que
// su propio delete — nunca un incremento agregado por cuenta aparte del
// borrado (eso dejaría una ventana real: si el proceso muere después de
// borrar el movement pero antes de aplicar su incremento, ese monto se
// pierde para siempre — el movement que lo originó ya no está para
// volver a calcularlo). Con delete+increment atómicos por chunk:
//   - la transacción completa, o no se aplica NADA de ese chunk (ni los
//     deletes ni los increments) — no hay estado a medias.
//   - rerun-safe sin necesidad de un log de progreso aparte: un chunk que
//     ya comprometió sus movements los borró DE VERDAD, así que una
//     relectura de movementsSnap en un segundo corrida (buildReport, al
//     volver a invocar el script) ya no los va a encontrar — solo ve los
//     que quedaron pendientes. El propio estado de Firestore (¿existe
//     el movement?) ES el marcador de "¿ya se revirtió?": no puede haber
//     un movement borrado cuya reversión no se haya aplicado, ni una
//     reversión aplicada dos veces, porque las dos cosas viven en la
//     misma transacción.
//
// Dos relecturas FRESCAS dentro de la transacción, nunca el snapshot con
// el que se armó el reporte (en dos pasos porque los accountId a mirar
// solo se conocen DESPUÉS de leer los movements frescos — todas las
// lecturas de una transacción tienen que ir antes que cualquier write,
// pero una transacción admite varios tx.getAll() en secuencia):
//   1. tx.getAll() de los movements del chunk. Uno que ya NO exista (lo
//      borró la app, o ya se procesó en una corrida anterior que se cortó
//      justo después de comprometer esta transacción pero antes de que
//      este script se enterara) se SALTA por completo — ni delete() (no
//      hay nada que borrar) ni revertir su monto (si la app lo borró por
//      la vía normal, removeShared() YA aplicó ese increment una vez;
//      sumarlo de nuevo acá sería un doble conteo).
//   2. tx.getAll() de las cuentas referenciadas por esos movements YA
//      FRESCOS (nunca por el accountId viejo de buildReport — si alguien
//      reasignó la cuenta del movement mientras tanto, esto sigue la
//      cuenta ACTUAL, no la de hace un rato).
//
// Un solo tx.update() por cuenta en este chunk, con la suma de todos los
// movements de ese chunk que la referencian — Firestore NO permite más de
// un write al mismo documento dentro de una misma transacción/batch (si
// seis movements comparten accountId, como en la tarjeta del grupo de
// prueba, seis tx.update() sobre la misma cuenta lanzarían
// "more than one write for the same document" al comprometer).
async function deleteMovementsAtomically(movementsSnap) {
  const docs = movementsSnap.docs;
  let totalSkipped = 0;

  for (let i = 0; i < docs.length; i += DELETE_CHUNK_SIZE) {
    const chunk = docs.slice(i, i + DELETE_CHUNK_SIZE);

    await firestore.runTransaction(async (tx) => {
      const movementSnaps = await tx.getAll(...chunk.map((doc) => doc.ref));
      const existingMovementSnaps = movementSnaps.filter((snap) => snap.exists);
      totalSkipped += movementSnaps.length - existingMovementSnaps.length;

      const chunkDeltaByAccount = new Map(); // accountId -> suma de amount en ESTE chunk
      if (REVERT_BALANCES) {
        for (const snap of existingMovementSnaps) {
          const data = snap.data();
          if (data.accountId) {
            chunkDeltaByAccount.set(data.accountId, (chunkDeltaByAccount.get(data.accountId) ?? 0) + data.amount);
          }
        }
      }

      let existingAccountIds = new Set();
      if (chunkDeltaByAccount.size > 0) {
        const accountRefs = [...chunkDeltaByAccount.keys()].map((id) => firestore.collection('accounts').doc(id));
        const accountSnaps = await tx.getAll(...accountRefs);
        existingAccountIds = new Set(accountSnaps.filter((snap) => snap.exists).map((snap) => snap.id));
      }

      for (const snap of existingMovementSnaps) {
        tx.delete(snap.ref);
      }
      for (const [accountId, delta] of chunkDeltaByAccount) {
        if (existingAccountIds.has(accountId)) {
          tx.update(firestore.collection('accounts').doc(accountId), { balance: FieldValue.increment(delta) });
        }
      }
    });
  }

  if (totalSkipped > 0) {
    console.log(
      `  (${totalSkipped} movement(s) ya no existían al momento de borrar — alguien los borró entre el reporte y ahora; se saltaron sin tocar ninguna cuenta.)`
    );
  }
}

// Respaldo PREVIO a cualquier escritura (ver deleteGroup()) — siempre que
// se llega a --apply, con o sin --revert-balances: si algo sale mal (o se
// quiere revertir manualmente después), este archivo tiene todo lo
// necesario para reconstruir los saldos a mano. FUERA del repo (ver
// BACKUP_DIR arriba) para que nunca termine commiteado por accidente.
//
// El nombre lleva el timestamp completo (milisegundos, vía
// Date.toISOString()) — dos corridas nunca pisan el mismo archivo, ni
// siquiera una justo después de la otra tras un corte a mitad de camino.
// Pero si ya existe un respaldo ANTERIOR de este mismo grupo en
// BACKUP_DIR, el "saldo antes" de ESTE respaldo ya refleja lo que esa
// corrida anterior llegó a revertir (si llegó a aplicar algo) — no es el
// saldo original de antes de la primera vez. Se avisa explícitamente para
// que, si hace falta reconstruir desde el inicio, se use el respaldo MÁS
// VIEJO de la lista, no este.
async function writeBackupFile(report) {
  const { groupId, group, movementsSnap, accountsById } = report;
  const timestamp = new Date().toISOString();

  const previousBackups = await listPreviousBackups(groupId);

  const movements = movementsSnap.docs.map((doc) => {
    const data = doc.data();
    return { id: doc.id, accountId: data.accountId ?? null, amount: data.amount, type: data.type };
  });

  const accountIds = [...new Set(movements.map((m) => m.accountId).filter(Boolean))];
  const accountsBefore = {};
  for (const accountId of accountIds) {
    const account = accountsById.get(accountId);
    accountsBefore[accountId] = account
      ? { name: account.name, uid: account.uid, balanceBefore: account.balance }
      : { exists: false };
  }

  const backup = {
    timestamp,
    groupId,
    groupName: group.name,
    revertBalances: REVERT_BALANCES,
    includeLinked: INCLUDE_LINKED,
    movements,
    accountsBefore,
  };

  await mkdir(BACKUP_DIR, { recursive: true });
  const fileName = `delete-group_${groupId}_${timestamp.replace(/[:.]/g, '-')}.json`;
  const filePath = join(BACKUP_DIR, fileName);
  await writeFile(filePath, JSON.stringify(backup, null, 2), 'utf8');

  if (previousBackups.length > 0) {
    console.log(
      `\n⚠ Ya hay ${previousBackups.length} respaldo(s) anterior(es) de este grupo en ${BACKUP_DIR}: ${previousBackups.join(', ')}`
    );
    console.log(
      '  El "saldo antes" (balanceBefore) de ESTE respaldo nuevo ya incluye lo que se revirtió en esa corrida anterior (si llegó a aplicar algo) — NO es el saldo original de antes de la primera vez.'
    );
    console.log(`  Para reconstruir desde el inicio, usa el respaldo MÁS VIEJO de la lista: ${previousBackups[0]}`);
  }

  return filePath;
}

// Ordenados por nombre == ordenados por timestamp (el nombre empieza con
// el ISO completo), así que el primero de la lista es siempre el más
// viejo — el que tiene el saldo ORIGINAL, de antes de cualquier corrida.
async function listPreviousBackups(groupId) {
  try {
    const entries = await readdir(BACKUP_DIR);
    return entries.filter((name) => name.startsWith(`delete-group_${groupId}_`) && name.endsWith('.json')).sort();
  } catch {
    return []; // la carpeta de respaldos todavía no existe — primera corrida de cualquier grupo.
  }
}

async function countRemaining(groupId) {
  const counts = await Promise.all(OWNED_COLLECTIONS.map((name) => countWhere(name, groupId)));
  const groupSnap = await firestore.collection('groups').doc(groupId).get();
  return {
    movements: counts[0],
    settlements: counts[1],
    goalEntries: counts[2],
    recurringPayments: counts[3],
    groupExists: groupSnap.exists,
  };
}

async function deleteGroup(groupId) {
  const report = await buildReport(groupId);
  printReport(report);

  if (!APPLY) {
    console.log('Modo dry-run: no se borró nada.');
    console.log(
      `Si todo se ve bien: node scripts/delete-group.mjs --group ${groupId} --apply${REVERT_BALANCES ? ' --revert-balances' : ''} --confirm "${report.group.name}"`
    );
    return;
  }

  if (CONFIRM_NAME !== report.group.name) {
    console.error(
      `\n--confirm ("${CONFIRM_NAME ?? ''}") no coincide EXACTO con el nombre del grupo ("${report.group.name}"). Abortado — no se tocó nada.`
    );
    process.exitCode = 1;
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer;
  try {
    answer = await rl.question(`\n¿Seguro que quieres borrar el grupo "${report.group.name}" (${groupId})? Esto no se puede deshacer. (y/N) `);
  } finally {
    rl.close();
  }
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Cancelado. No se borró nada.');
    return;
  }

  const { movementsSnap, settlementsSnap, goalEntriesSnap, recurringSnap, linkedMovements, groupRef, accountDeltas, accountsById } =
    report;

  // Respaldo ANTES de tocar nada — si esto falla, se aborta sin escribir:
  // de nada sirve una reversión de saldos sin el respaldo que permitiría
  // reconstruirla a mano si algo sale mal.
  let backupPath;
  try {
    backupPath = await writeBackupFile(report);
  } catch (error) {
    console.error(`\n⚠ No se pudo escribir el respaldo en ${BACKUP_DIR} — abortado, no se tocó nada.`, error);
    process.exitCode = 1;
    return;
  }
  console.log(`\nRespaldo guardado en: ${backupPath}`);

  console.log('\nBorrando adjuntos en Storage...');
  await deleteAttachments('movements', movementsSnap.docs.map((doc) => doc.id));
  await deleteAttachments('goalEntries', goalEntriesSnap.docs.map((doc) => doc.id));
  await deleteAttachments('settlements', settlementsSnap.docs.map((doc) => doc.id));

  // Orden en Firestore: goalEntries/recurringPayments no tienen ningún
  // trigger que reaccione a su borrado, así que van primero sin ningún
  // cuidado especial. movements SIEMPRE antes que settlements: anular/
  // borrar un settlement dispara syncInstallmentStatus (onDocumentWritten,
  // SÍ reacciona a deletes), que relee los movements del grupo DENTRO de
  // la misma transacción y llama tx.update() sobre los que tengan cuotas.
  // Si ya no queda ningún movement (porque este script los borró primero),
  // esa relectura sale vacía y la función no intenta escribir nada — cero
  // riesgo de que su tx.update() choque con un doc que ya no existe
  // (NOT_FOUND). El trigger nunca puede recrear un movement borrado: solo
  // llama tx.update() sobre refs existentes, nunca tx.set()/create().
  console.log('Borrando goalEntries...');
  await deleteRefs(goalEntriesSnap.docs.map((doc) => doc.ref));
  console.log('Borrando recurringPayments...');
  await deleteRefs(recurringSnap.docs.map((doc) => doc.ref));
  console.log(
    `Borrando movements${REVERT_BALANCES ? ' (revirtiendo saldos atómicamente, --revert-balances)' : ''}...`
  );
  await deleteMovementsAtomically(movementsSnap);
  console.log('Borrando settlements...');
  await deleteRefs(settlementsSnap.docs.map((doc) => doc.ref));

  if (INCLUDE_LINKED && linkedMovements.length > 0) {
    console.log('Borrando movements personales vinculados (--include-linked)...');
    await deleteRefs(linkedMovements.map((doc) => doc.ref));
  }

  console.log('Borrando el grupo...');
  await groupRef.delete();

  const remaining = await countRemaining(groupId);
  const allClear =
    remaining.movements === 0 &&
    remaining.settlements === 0 &&
    remaining.goalEntries === 0 &&
    remaining.recurringPayments === 0 &&
    !remaining.groupExists;

  console.log('\nVerificación final:');
  console.log(
    `  movements=${remaining.movements}  settlements=${remaining.settlements}  goalEntries=${remaining.goalEntries}  recurringPayments=${remaining.recurringPayments}  grupo existe=${remaining.groupExists}`
  );
  console.log(allClear ? '✅ Listo — quedó todo en 0 y el grupo ya no existe.' : '⚠ Algo no quedó en 0 — revisa a mano.');

  if (REVERT_BALANCES) {
    await printFinalBalances(accountDeltas, accountsById);
  }
}

async function printFinalBalances(accountDeltas, accountsById) {
  const touchedExistingIds = [...accountDeltas.keys()].filter((id) => accountsById.has(id));
  if (touchedExistingIds.length === 0) {
    return;
  }
  const refs = touchedExistingIds.map((id) => firestore.collection('accounts').doc(id));
  const snaps = await firestore.getAll(...refs);

  console.log('\nSaldo final de las cuentas tocadas (--revert-balances):');
  for (const snap of snaps) {
    if (!snap.exists) {
      console.log(`  ${snap.id}: ya no existe.`);
      continue;
    }
    console.log(`  "${snap.data().name}" (${snap.id}): $${snap.data().balance}`);
  }
}

async function main() {
  if (!GROUP_ID) {
    if (APPLY) {
      throw new Error('--apply necesita --group <groupId>.');
    }
    await listAllGroups();
    return;
  }
  await deleteGroup(GROUP_ID);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exitCode = 1;
});
