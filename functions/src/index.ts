import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();

// Misma región que Firestore (ver firebase.json) — evita latencia entre
// regiones y mantiene todo el proyecto en un solo lugar.
const REGION = 'us-east1';

// Mismo secret que ya existe en el Worker (wrangler secret put INTERNAL_KEY,
// Fase 0) — Cloud Functions no puede leer el secret store de Cloudflare, así
// que necesita su PROPIA copia del mismo valor en el Secret Manager de
// Firebase. Configúralo con `firebase functions:secrets:set INTERNAL_KEY`
// (pega el mismo valor que le diste a wrangler) antes de desplegar.
const internalKey = defineSecret('INTERNAL_KEY');

// Tiene que coincidir con workerUrl en environment.ts/environment.prod.ts —
// dos proyectos TS separados, sin import compartido posible (mismo caso que
// RECURRING_PAYMENTS_CHANNEL_ID/MONTHLY_INSIGHT_CHANNEL_ID más abajo).
const WORKER_URL = 'https://maxfinance-worker.damaxa134.workers.dev';

// Tienen que coincidir con los mismos ids en
// src/app/core/notifications/notifications.ts — ver el comentario ahí.
const RECURRING_PAYMENTS_CHANNEL_ID = 'recurring-payments';
const MONTHLY_INSIGHT_CHANNEL_ID = 'monthly-insight';

interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

function toUserProfile(snap: DocumentSnapshot): UserProfile {
  const data = snap.data() ?? {};
  return {
    uid: snap.id,
    displayName: (data['displayName'] as string | undefined) ?? '',
    email: (data['email'] as string | undefined) ?? '',
    photoURL: (data['photoURL'] as string | undefined) ?? '',
  };
}

interface InviteGroupMemberRequest {
  groupId: string;
  email?: string;
  uid?: string;
}

interface InviteGroupMemberResponse {
  uid: string;
}

// Agrega a alguien a members, resuelto por email (invitación manual) o
// directamente por uid (chip de un contacto ya conocido — ver
// getKnownContacts, que evita resolverlo de nuevo por email). Corre con
// el Admin SDK (bypassa las reglas de seguridad de Firestore a propósito):
// el cliente nunca puede listar la colección users por email directamente
// — ver DATABASE.md, "Invitación a grupo por email, resuelta a uid vía
// Cloud Function callable (no se expone la lista de usuarios al cliente)".
export const inviteGroupMember = onCall({ region: REGION }, async (request): Promise<InviteGroupMemberResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const data = request.data as InviteGroupMemberRequest;
  const groupId = data?.groupId?.trim();
  const rawEmail = data?.email?.trim().toLowerCase();
  const rawUid = data?.uid?.trim();
  if (!groupId || (!rawEmail && !rawUid)) {
    throw new HttpsError('invalid-argument', 'Falta el grupo y el correo o la persona a invitar.');
  }

  const firestore = getFirestore();
  const groupRef = firestore.collection('groups').doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', 'El grupo no existe.');
  }

  const members = (groupSnap.data()?.['members'] as string[] | undefined) ?? [];
  if (!members.includes(uid)) {
    throw new HttpsError('permission-denied', 'No perteneces a este grupo.');
  }

  let invitedUid: string;
  if (rawUid) {
    const targetSnap = await firestore.collection('users').doc(rawUid).get();
    if (!targetSnap.exists) {
      throw new HttpsError('not-found', 'Esta persona aún no tiene cuenta en MaxFinance.');
    }
    invitedUid = rawUid;
  } else {
    const usersQuery = await firestore.collection('users').where('email', '==', rawEmail).limit(1).get();
    if (usersQuery.empty) {
      throw new HttpsError('not-found', 'Esta persona aún no tiene cuenta en MaxFinance.');
    }
    invitedUid = usersQuery.docs[0].id;
  }

  if (members.includes(invitedUid)) {
    throw new HttpsError('already-exists', 'Esta persona ya es miembro del grupo.');
  }

  await groupRef.update({ members: FieldValue.arrayUnion(invitedUid) });

  return { uid: invitedUid };
});

interface LeaveGroupRequest {
  groupId: string;
}

// Sale del grupo por cuenta propia. Corre server-side porque la regla de
// Firestore de groups solo permite update/delete a createdBy o admin — un
// miembro cualquiera no podría hacer arrayRemove(su propio uid) desde el
// cliente sin abrir esa misma capacidad de forma más amplia (ver el
// comentario en firestore.rules, "queda para una Cloud Function callable").
export const leaveGroup = onCall({ region: REGION }, async (request): Promise<{ success: true }> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const groupId = (request.data as LeaveGroupRequest)?.groupId?.trim();
  if (!groupId) {
    throw new HttpsError('invalid-argument', 'Falta el grupo.');
  }

  const firestore = getFirestore();
  const groupRef = firestore.collection('groups').doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', 'El grupo no existe.');
  }

  const members = (groupSnap.data()?.['members'] as string[] | undefined) ?? [];
  if (!members.includes(uid)) {
    throw new HttpsError('permission-denied', 'No perteneces a este grupo.');
  }

  await groupRef.update({ members: FieldValue.arrayRemove(uid) });

  return { success: true };
});

interface GetGroupMembersRequest {
  groupId: string;
}

// Devuelve displayName/email/photoURL de cada miembro del grupo. Corre
// server-side porque la regla de users solo permite que cada uno lea su
// propio doc — no queremos abrir esa colección a cualquier uid conocido
// desde el cliente (ver DATABASE.md sobre no exponer datos de usuarios).
export const getGroupMembers = onCall({ region: REGION }, async (request): Promise<UserProfile[]> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const groupId = (request.data as GetGroupMembersRequest)?.groupId?.trim();
  if (!groupId) {
    throw new HttpsError('invalid-argument', 'Falta el grupo.');
  }

  const firestore = getFirestore();
  const groupSnap = await firestore.collection('groups').doc(groupId).get();
  if (!groupSnap.exists) {
    throw new HttpsError('not-found', 'El grupo no existe.');
  }

  const members = (groupSnap.data()?.['members'] as string[] | undefined) ?? [];
  if (!members.includes(uid)) {
    throw new HttpsError('permission-denied', 'No perteneces a este grupo.');
  }
  if (members.length === 0) {
    return [];
  }

  const userSnaps = await firestore.getAll(...members.map((memberUid) => firestore.collection('users').doc(memberUid)));

  return userSnaps.filter((snap) => snap.exists).map(toUserProfile);
});

// Sugerencias de "gente que ya conoces": uids distintos de todos los
// grupos donde el usuario actual es miembro, sin importar cuál se está
// viendo ahora — el cliente filtra localmente a quién ya pertenece al
// grupo específico que tiene abierto (ver GroupDetail.suggestedContacts).
// Decisión de privacidad explícita (DATABASE.md): nunca el directorio
// completo de usuarios, solo con quien ya se comparte un grupo.
export const getKnownContacts = onCall({ region: REGION }, async (request): Promise<UserProfile[]> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const firestore = getFirestore();
  const groupsSnap = await firestore.collection('groups').where('members', 'array-contains', uid).get();

  const contactUids = new Set<string>();
  for (const doc of groupsSnap.docs) {
    const members = (doc.data()['members'] as string[] | undefined) ?? [];
    for (const memberUid of members) {
      if (memberUid !== uid) {
        contactUids.add(memberUid);
      }
    }
  }

  if (contactUids.size === 0) {
    return [];
  }

  const userSnaps = await firestore.getAll(
    ...Array.from(contactUids).map((contactUid) => firestore.collection('users').doc(contactUid))
  );

  return userSnaps.filter((snap) => snap.exists).map(toUserProfile);
});

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// setMonth() ingenuo tiene el bug clásico de fin de mes: 31 de enero + 1 mes
// da 3 de marzo (Date hace overflow al mes siguiente porque febrero no tiene
// 31 días), no 28 de febrero — confirmado con Date(2026,0,31).setMonth(1)
// antes de este fix. Acá se calcula primero el mes destino, se calcula
// cuántos días tiene, y se recorta el día original a ese máximo.
function addMonthsClamped(date: Date, months: number): Date {
  const targetMonthIndex = date.getMonth() + months;
  const firstOfTargetMonth = new Date(date.getFullYear(), targetMonthIndex, 1);
  const lastDayOfTargetMonth = new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth() + 1, 0).getDate();
  const day = Math.min(date.getDate(), lastDayOfTargetMonth);
  return new Date(
    firstOfTargetMonth.getFullYear(),
    firstOfTargetMonth.getMonth(),
    day,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

// Fase 9 (BACKLOG 63): antes solo 'monthly'/'weekly' — 'monthly' sigue
// siendo el default para cualquier valor futuro que DATABASE.md deja
// abierto, en vez de fallar en silencio o quedar sin avanzar nunca.
function advanceNextDate(current: Date, frequency: string): Date {
  switch (frequency) {
    case 'daily':
      return addDays(current, 1);
    case 'weekly':
      return addDays(current, 7);
    case 'biweekly':
      return addDays(current, 15);
    case 'bimonthly':
      return addMonthsClamped(current, 2);
    case 'quarterly':
      return addMonthsClamped(current, 3);
    case 'semiannual':
      return addMonthsClamped(current, 6);
    case 'annual':
      return addMonthsClamped(current, 12);
    case 'monthly':
    default:
      return addMonthsClamped(current, 1);
  }
}

interface PushNotificationContent {
  title: string;
  body: string;
  channelId: string;
}

// Envía la notificación a TODOS los dispositivos del usuario (no solo el
// último) — si algún token falla porque el dispositivo ya no existe
// ("unregistered"), se elimina de fcmTokens para no seguir intentando en
// cada corrida. Nunca lanza: un fallo de notificación no debe tumbar el
// procesamiento del recurrente/insight, que ya quedó guardado antes de
// llegar acá. Compartida entre processRecurringPayments y
// generateMonthlyInsights — la única diferencia entre ambos es el
// título/cuerpo/canal.
async function sendPushNotification(firestore: Firestore, uid: string, content: PushNotificationContent): Promise<void> {
  const userSnap = await firestore.collection('users').doc(uid).get();
  const tokens = (userSnap.data()?.['fcmTokens'] as string[] | undefined) ?? [];
  console.log(`[sendPushNotification] ${uid}: ${tokens.length} token(s) registrados`);
  if (tokens.length === 0) {
    return;
  }

  const messaging = getMessaging();
  const deadTokens: string[] = [];

  await Promise.all(
    tokens.map(async (token) => {
      const shortToken = `${token.slice(0, 12)}…`;
      try {
        const messageId = await messaging.send({
          token,
          notification: { title: content.title, body: content.body },
          // Tiene que coincidir con el id de canal creado del lado del
          // cliente (ver src/app/core/notifications/notifications.ts) —
          // sin esto, Android puede enrutar la notificación a un canal
          // genérico en vez del que se creó.
          android: { notification: { channelId: content.channelId } },
        });
        console.log(`[sendPushNotification] enviado a ${shortToken} — messageId=${messageId}`);
      } catch (error) {
        if ((error as { code?: string }).code === 'messaging/registration-token-not-registered') {
          console.log(`[sendPushNotification] token ${shortToken} ya no existe, se elimina de ${uid}`);
          deadTokens.push(token);
        } else {
          console.error(`[sendPushNotification] error enviando a ${shortToken} (uid ${uid})`, error);
        }
      }
    })
  );

  if (deadTokens.length > 0) {
    await firestore.collection('users').doc(uid).update({ fcmTokens: FieldValue.arrayRemove(...deadTokens) });
  }
}

async function notifyRecurringPaymentProcessed(
  firestore: Firestore,
  uid: string,
  paymentName: string,
  amount: number
): Promise<void> {
  await sendPushNotification(firestore, uid, {
    title: 'Pago recurrente procesado',
    body: `${paymentName}: $${amount.toLocaleString('es-CO')}`,
    channelId: RECURRING_PAYMENTS_CHANNEL_ID,
  });
}

// Corre una vez al día: por cada recurringPayment personal activo con
// nextDate <= hoy, crea el movement correspondiente, descuenta la cuenta y
// avanza nextDate — todo en una sola transacción, para que el movement y el
// avance de fecha nunca queden desincronizados. Solo después de que la
// transacción confirma, notifica (la notificación es best-effort, no forma
// parte de la atomicidad del registro contable).
//
// Nota: los recurrentes de grupo (uid == null, groupId != null) existen en
// el modelo de datos (ver DATABASE.md) pero esta fase solo construyó la UI
// para los personales — se ignoran acá hasta que exista ese flujo.
export const processRecurringPayments = onSchedule(
  { schedule: 'every day 06:00', timeZone: 'America/Bogota', region: REGION },
  async () => {
    const firestore = getFirestore();
    const now = Timestamp.now();

    const dueSnap = await firestore
      .collection('recurringPayments')
      .where('active', '==', true)
      .where('nextDate', '<=', now)
      .get();

    console.log(`[processRecurringPayments] ${dueSnap.size} recurrente(s) vencido(s) encontrado(s)`);

    for (const paymentDoc of dueSnap.docs) {
      const payment = paymentDoc.data();
      const uid = payment['uid'] as string | null;
      if (!uid) {
        console.log(`[processRecurringPayments] ${paymentDoc.id} es de grupo (uid null) — se ignora por ahora`);
        continue;
      }

      console.log(`[processRecurringPayments] procesando ${paymentDoc.id} ("${payment['name']}") de ${uid}`);

      const amount = payment['amount'] as number;
      const accountId = payment['accountId'] as string;
      const categoryId = payment['categoryId'] as string;
      const frequency = (payment['frequency'] as string) ?? 'monthly';
      const dueDate = (payment['nextDate'] as Timestamp).toDate();
      const newNextDate = advanceNextDate(dueDate, frequency);

      const movementRef = firestore.collection('movements').doc();
      const accountRef = firestore.collection('accounts').doc(accountId);

      try {
        await firestore.runTransaction(async (tx) => {
          tx.set(movementRef, {
            uid,
            accountId,
            categoryId,
            type: 'expense',
            amount,
            date: Timestamp.fromDate(dueDate),
            note: `Pago recurrente: ${payment['name']}`,
            groupId: null,
          });
          tx.update(accountRef, { balance: FieldValue.increment(-amount) });
          tx.update(paymentDoc.ref, { nextDate: Timestamp.fromDate(newNextDate) });
        });
      } catch (error) {
        console.error(`[processRecurringPayments] error procesando ${paymentDoc.id}`, error);
        continue;
      }

      console.log(
        `[processRecurringPayments] ${paymentDoc.id}: movement ${movementRef.id} creado, nextDate avanzada a ${newNextDate.toISOString()}`
      );

      await notifyRecurringPaymentProcessed(firestore, uid, payment['name'] as string, amount);
    }
  }
);

// Bogotá no tiene horario de verano (UTC-5 fijo todo el año) — por eso este
// truco (correr el reloj el offset y leer los getters UTC como si fueran la
// hora de pared local) es seguro acá. NO sería seguro en una zona con DST,
// donde el offset cambia según la fecha.
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

function toBogotaWallClock(date: Date): Date {
  return new Date(date.getTime() - BOGOTA_OFFSET_MS);
}

function monthKeyOf(wallClock: Date): string {
  return `${wallClock.getUTCFullYear()}-${String(wallClock.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Medianoche en Bogotá del día 1 de ese mes, como Timestamp real (instante
// UTC) — para filtrar movements por rango de fecha.
function bogotaMonthStart(year: number, monthIndex0: number): Timestamp {
  return Timestamp.fromMillis(Date.UTC(year, monthIndex0, 1) + BOGOTA_OFFSET_MS);
}

function monthLabelEs(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  // Día 15 (no el 1) para no arriesgar cruzar de mes por el offset al
  // formatear — timeZone: 'UTC' porque monthKey ya está en términos de
  // Bogotá, no hay que volver a desplazar nada acá.
  const date = new Date(Date.UTC(year, month - 1, 15));
  return new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'UTC' }).format(date);
}

interface MonthlyContext {
  accounts: { name: string; balance: number }[];
  categoryTotals: { category: string; total: number }[];
  budget: { limit: number; spent: number; percentage: number } | null;
}

interface MovementForInsight {
  type: string;
  amount: number;
  categoryId: string;
  date: Timestamp;
  paidBy?: string;
}

// Arma el mismo tipo de contexto que ya usa el análisis bajo demanda
// (src/app/features/accounts/balances-modal/balances-modal.ts) pero del mes
// que acaba de cerrar. Devuelve null si el usuario no tuvo ningún movement
// ese mes (no vale la pena gastar una llamada de IA en alguien inactivo).
async function buildMonthlyContext(
  firestore: Firestore,
  uid: string,
  rangeStart: Timestamp,
  rangeEnd: Timestamp,
  targetMonth: string,
  baseCategoriesById: Map<string, string>
): Promise<MonthlyContext | null> {
  // Un solo query por uid (sin filtrar groupId) trae tanto los movimientos
  // personales como los compartidos que este usuario registró — el mismo
  // conjunto que combinedMovements$ arma del lado del cliente (ver
  // DATABASE.md/movements.ts) — y el mes se filtra en memoria, igual que
  // hace el cliente (personalMovements$ tampoco filtra por fecha en el
  // query), para no depender de un índice compuesto (uid, date).
  const movementsSnap = await firestore.collection('movements').where('uid', '==', uid).get();
  const monthMovements = movementsSnap.docs
    .map((doc) => doc.data() as MovementForInsight)
    .filter((movement) => {
      const millis = movement.date.toMillis();
      return millis >= rangeStart.toMillis() && millis < rangeEnd.toMillis();
    });

  if (monthMovements.length === 0) {
    return null;
  }

  // Mismo criterio que sumExpensesByCategory (src/app/core/budget-progress):
  // solo cuenta lo que el usuario efectivamente pagó, no lo que solo
  // registró a nombre de otro miembro del grupo.
  const spentByCategory = new Map<string, number>();
  for (const movement of monthMovements) {
    if (movement.type !== 'expense') {
      continue;
    }
    if (movement.paidBy !== undefined && movement.paidBy !== uid) {
      continue;
    }
    spentByCategory.set(movement.categoryId, (spentByCategory.get(movement.categoryId) ?? 0) + movement.amount);
  }

  const customCategoriesSnap = await firestore.collection('categories').where('uid', '==', uid).get();
  const categoriesById = new Map(baseCategoriesById);
  for (const doc of customCategoriesSnap.docs) {
    categoriesById.set(doc.id, doc.data()['name'] as string);
  }

  const categoryTotals = [...spentByCategory.entries()].map(([categoryId, total]) => ({
    category: categoriesById.get(categoryId) ?? 'Categoría eliminada',
    total,
  }));

  const accountsSnap = await firestore.collection('accounts').where('uid', '==', uid).get();
  const accounts = accountsSnap.docs.map((doc) => ({
    name: doc.data()['name'] as string,
    balance: doc.data()['balance'] as number,
  }));

  const budgetsSnap = await firestore.collection('budgets').where('uid', '==', uid).where('month', '==', targetMonth).get();
  let budget: MonthlyContext['budget'] = null;
  if (!budgetsSnap.empty) {
    let totalLimit = 0;
    let totalSpent = 0;
    for (const doc of budgetsSnap.docs) {
      totalLimit += doc.data()['limit'] as number;
      totalSpent += spentByCategory.get(doc.data()['categoryId'] as string) ?? 0;
    }
    budget = { limit: totalLimit, spent: totalSpent, percentage: totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0 };
  }

  return { accounts, categoryTotals, budget };
}

// Llama al Worker servidor-a-servidor con X-Internal-Key (ver worker/src/
// index.ts, handleMonthlySummary) — a diferencia de /summary (IA bajo
// demanda), este endpoint no comparte el límite de 24h de KV: este flujo ya
// está controlado por correr una sola vez al mes.
async function requestMonthlySummary(uid: string, context: MonthlyContext, key: string): Promise<string> {
  const response = await fetch(`${WORKER_URL}/monthly-summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Internal-Key': key },
    body: JSON.stringify({ uid, ...context }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`worker_monthly_summary_http_${response.status}: ${detail}`);
  }

  const data = (await response.json()) as { summary: string };
  return data.summary;
}

async function notifyMonthlyInsightReady(firestore: Firestore, uid: string, targetMonth: string): Promise<void> {
  await sendPushNotification(firestore, uid, {
    title: 'Tu resumen mensual ya está listo',
    body: `Ya está listo tu resumen de ${monthLabelEs(targetMonth)}.`,
    channelId: MONTHLY_INSIGHT_CHANNEL_ID,
  });
}

// Corre una vez al mes, el día 1 a las 7am hora Bogotá — después del
// schedule diario de recurrentes (6am) para no competir por recursos (ver
// BACKLOG.md, tarea 56). Por cada usuario con actividad en el mes que
// acaba de cerrar, genera su insight vía el Worker y lo guarda en
// monthlyInsights/{uid}_{month} (nunca escrito desde el cliente — ver
// DATABASE.md), y notifica push. Idempotente por diseño (doc id
// determinístico + notifiedAt): si la función corre dos veces por error,
// no vuelve a llamar a la IA ni a duplicar la notificación.
export const generateMonthlyInsights = onSchedule(
  { schedule: '1 of month 07:00', timeZone: 'America/Bogota', region: REGION, secrets: [internalKey] },
  async () => {
    const firestore = getFirestore();

    const nowWallClock = toBogotaWallClock(new Date());
    const targetYear = nowWallClock.getUTCFullYear();
    const targetMonthIndex0 = nowWallClock.getUTCMonth() - 1; // el mes que ya cerró
    const targetMonth = monthKeyOf(new Date(Date.UTC(targetYear, targetMonthIndex0, 1)));
    const rangeStart = bogotaMonthStart(targetYear, targetMonthIndex0);
    const rangeEnd = bogotaMonthStart(targetYear, targetMonthIndex0 + 1);

    const baseCategoriesSnap = await firestore.collection('categories').where('uid', '==', null).get();
    const baseCategoriesById = new Map(baseCategoriesSnap.docs.map((doc) => [doc.id, doc.data()['name'] as string]));

    const usersSnap = await firestore.collection('users').get();
    console.log(`[generateMonthlyInsights] ${usersSnap.size} usuario(s) — mes objetivo ${targetMonth}`);

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const insightRef = firestore.collection('monthlyInsights').doc(`${uid}_${targetMonth}`);
      const existing = await insightRef.get();

      if (existing.exists) {
        if (existing.data()?.['notifiedAt']) {
          continue; // ya se generó y ya se notificó — nada que hacer
        }
        // El texto ya se generó pero la notificación no llegó a
        // confirmarse (la función corrió dos veces, o falló justo después
        // de guardar el doc) — no volver a llamar a la IA, solo reintentar
        // el push.
        console.log(`[generateMonthlyInsights] ${uid}: insight ya generado, reintentando la notificación`);
        await notifyMonthlyInsightReady(firestore, uid, targetMonth);
        await insightRef.update({ notifiedAt: Timestamp.now() });
        continue;
      }

      const context = await buildMonthlyContext(firestore, uid, rangeStart, rangeEnd, targetMonth, baseCategoriesById);
      if (!context) {
        console.log(`[generateMonthlyInsights] ${uid}: sin actividad en ${targetMonth} — se salta`);
        continue;
      }

      let text: string;
      try {
        text = await requestMonthlySummary(uid, context, internalKey.value());
      } catch (error) {
        console.error(`[generateMonthlyInsights] error generando el insight de ${uid}`, error);
        continue;
      }

      await insightRef.set({ uid, month: targetMonth, text, generatedAt: Timestamp.now(), notifiedAt: null });
      console.log(`[generateMonthlyInsights] ${uid}: insight guardado`);

      await notifyMonthlyInsightReady(firestore, uid, targetMonth);
      await insightRef.update({ notifiedAt: Timestamp.now() });
    }
  }
);
