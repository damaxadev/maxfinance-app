import { initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { DocumentSnapshot, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { type MovementDocForDebts, type SettlementDocForDebts, cuotaDebtsForPair, remainingForDebt } from './debts';
import { buildSettlementCreatedNotification, buildSettlementVoidedNotification } from './settlement-notifications';

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
const GROUP_ACTIVITY_CHANNEL_ID = 'group-activity';
const SAVINGS_GOAL_CHANNEL_ID = 'savings-goal';

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

  // Best-effort: si falla el push, la invitación ya quedó registrada
  // igual (no se relanza el error). Cada invitación es una llamada
  // aparte a esta misma función, así que agregar a varias personas de
  // una siempre termina en una notificación por persona, nunca una sola
  // para todas.
  const inviterSnap = await firestore.collection('users').doc(uid).get();
  const inviterName = (inviterSnap.data()?.['displayName'] as string | undefined) || 'Alguien';
  const groupName = (groupSnap.data()?.['name'] as string | undefined) ?? 'un grupo';
  await sendPushNotification(firestore, invitedUid, {
    title: 'Te agregaron a un grupo',
    body: `${inviterName} te agregó al grupo ${groupName}`,
    channelId: GROUP_ACTIVITY_CHANNEL_ID,
    data: { type: 'group-detail', groupId },
  });

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
  // Deep link (ver notifications.ts del cliente, listenForNotificationTaps)
  // — FCM exige que los valores de "data" sean siempre string.
  data?: Record<string, string>;
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
          ...(content.data ? { data: content.data } : {}),
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

    // Recordatorio a 3 días — NO procesa el pago ni registra ningún
    // movement, solo avisa. El bloque de arriba (nextDate <= hoy) sigue
    // siendo el único que de verdad cobra/registra; esto es aparte.
    const reminderStart = bogotaDayBoundary(now.toDate(), 3);
    const reminderEnd = bogotaDayBoundary(now.toDate(), 4);
    const reminderSnap = await firestore
      .collection('recurringPayments')
      .where('active', '==', true)
      .where('nextDate', '>=', reminderStart)
      .where('nextDate', '<', reminderEnd)
      .get();

    console.log(`[processRecurringPayments] ${reminderSnap.size} recordatorio(s) a 3 días encontrado(s)`);

    for (const paymentDoc of reminderSnap.docs) {
      const payment = paymentDoc.data();
      const uid = payment['uid'] as string | null;
      if (!uid) {
        continue; // recurrente de grupo — mismo criterio que el bloque de arriba
      }
      const amount = payment['amount'] as number;
      await sendPushNotification(firestore, uid, {
        title: 'Pago próximo a vencer',
        body: `Tu pago de ${payment['name']} vence en 3 días: $${amount.toLocaleString('es-CO')}`,
        channelId: RECURRING_PAYMENTS_CHANNEL_ID,
      });
    }

    // Cuotas de gasto compartido — mismo chequeo diario, reusando el mismo
    // reminderStart/reminderEnd de arriba (ver remindPendingInstallments).
    await remindPendingInstallments(firestore, reminderStart, reminderEnd);

    // Metas de ahorro — mismo chequeo diario, agregado ACÁ adentro por el
    // mismo motivo que remindPendingInstallments (ver su comentario): no
    // crear un segundo Cloud Scheduler. A diferencia de los recordatorios
    // de arriba (que avisan 3 días ANTES de una fecha fija), esto es "hoy
    // toca aportar" — un recordatorio periódico sin fecha límite, así que
    // usa `now`, no una ventana de días.
    await remindSavingsGoalContributions(firestore, now);
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

// Medianoche en Bogotá de "baseDate + daysOffset días", como Timestamp real
// — usado por el recordatorio de recurrentes a 3 días (ver
// processRecurringPayments) para acotar nextDate a un día calendario
// completo en vez de una igualdad exacta de Timestamp, que se rompería si
// alguna vez existe un nextDate que no caiga justo en medianoche.
function bogotaDayBoundary(baseDate: Date, daysOffset: number): Timestamp {
  const wallClock = toBogotaWallClock(baseDate);
  const utcMidnight = Date.UTC(wallClock.getUTCFullYear(), wallClock.getUTCMonth(), wallClock.getUTCDate() + daysOffset);
  return Timestamp.fromMillis(utcMidnight + BOGOTA_OFFSET_MS);
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

interface MovementSplitForNotify {
  uid: string;
  amount: number;
}

// Se dispara al crear CUALQUIER movement — solo actúa si es un gasto
// compartido con división (groupId + paidBy + splits, ver DATABASE.md).
// Un movimiento personal (groupId: null, sin splits) no entra al if. Un
// gasto de un grupo personal de un solo miembro (ver SharedExpenseForm,
// "flujo personal") SÍ tiene splits, pero su único split es el propio
// pagador — el filtro `split.uid !== paidBy` de abajo lo deja en cero
// notificaciones sin necesitar ninguna rama especial acá.
export const notifySharedExpenseAssigned = onDocumentCreated({ document: 'movements/{movementId}', region: REGION }, async (event) => {
  const snap = event.data;
  if (!snap) {
    return;
  }
  const movement = snap.data();
  const groupId = movement['groupId'] as string | null;
  const paidBy = movement['paidBy'] as string | undefined;
  const splits = movement['splits'] as MovementSplitForNotify[] | undefined;
  if (!groupId || !paidBy || !splits || splits.length === 0) {
    return;
  }

  const firestore = getFirestore();
  const [groupSnap, payerSnap] = await Promise.all([
    firestore.collection('groups').doc(groupId).get(),
    firestore.collection('users').doc(paidBy).get(),
  ]);
  const groupName = (groupSnap.data()?.['name'] as string | undefined) ?? 'un grupo';
  const payerName = (payerSnap.data()?.['displayName'] as string | undefined) || 'Alguien';

  // Cada miembro que quede debiendo recibe la suya, con su propio monto —
  // nunca una sola notificación agregada para todos. Quien pagó queda
  // afuera: ya sabe que lo registró.
  const debtors = splits.filter((split) => split.uid !== paidBy && split.amount > 0);
  console.log(`[notifySharedExpenseAssigned] ${event.params.movementId}: ${debtors.length} deudor(es) a notificar`);

  await Promise.all(
    debtors.map((split) =>
      sendPushNotification(firestore, split.uid, {
        title: 'Nuevo gasto compartido',
        body: `${payerName} agregó un gasto en ${groupName}: debes $${split.amount.toLocaleString('es-CO')}`,
        channelId: GROUP_ACTIVITY_CHANNEL_ID,
        data: { type: 'group-detail', groupId },
      })
    )
  );
});

interface InstallmentData {
  dueDate: Timestamp;
  amount: number;
  status: string;
}

interface PayInstallmentRequest {
  movementId: string;
  installmentIndex: number;
  note?: string;
}

interface PayInstallmentResponse {
  settlementId: string;
}

// Compartidos por payInstallment y syncInstallmentStatus: pasar de los
// QueryDocumentSnapshot crudos de `movements`/`settlements` a la forma
// plana que espera functions/src/debts.ts — una sola vez, en vez de
// repetir el mapeo en cada función que necesita leer el grupo completo.
function toMovementDocsForDebts(docs: QueryDocumentSnapshot[]): MovementDocForDebts[] {
  return docs.map((movementDoc) => {
    const data = movementDoc.data();
    return {
      id: movementDoc.id,
      date: data['date'] as Timestamp,
      paidBy: data['paidBy'] as string,
      splits: (data['splits'] as MovementSplitForNotify[] | undefined) ?? [],
      installments: data['installments'] as InstallmentData[] | null | undefined,
    };
  });
}

function toSettlementDocsForDebts(docs: QueryDocumentSnapshot[]): SettlementDocForDebts[] {
  return docs.map((settlementDoc) => settlementDoc.data() as SettlementDocForDebts);
}

// Paga una cuota específica de un plan de cuotas (ver DATABASE.md, "Pagos a
// cuotas") — crea el abono (con allocations) Y marca esa cuota como pagada
// en el movement de origen, atómico (una transacción), para que nunca
// queden desalineados. Corre server-side porque actualizar installments[i]
// en el movement requiere escribir un documento que el deudor no
// necesariamente "posee" (uid == quien registró el gasto, no
// necesariamente el deudor) — la regla de movements solo permite update a
// isOwner(uid). A diferencia de SettlementsService.createSettlement()
// (cliente), esta vía no soporta "registrar también como movimiento
// personal" — no se pidió para cuotas, y evita duplicar esa lógica acá.
export const payInstallment = onCall({ region: REGION }, async (request): Promise<PayInstallmentResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }

  const data = request.data as PayInstallmentRequest;
  const movementId = data?.movementId?.trim();
  const installmentIndex = data?.installmentIndex;
  if (!movementId || typeof installmentIndex !== 'number') {
    throw new HttpsError('invalid-argument', 'Falta el gasto o el número de cuota.');
  }
  const note = data?.note ?? '';

  const firestore = getFirestore();
  const movementRef = firestore.collection('movements').doc(movementId);
  const settlementRef = firestore.collection('settlements').doc();

  return firestore.runTransaction(async (tx) => {
    const movementSnap = await tx.get(movementRef);
    if (!movementSnap.exists) {
      throw new HttpsError('not-found', 'El gasto no existe.');
    }
    const movement = movementSnap.data()!;
    const groupId = movement['groupId'] as string | undefined;
    const paidBy = movement['paidBy'] as string | undefined;
    const splits = (movement['splits'] as MovementSplitForNotify[] | undefined) ?? [];
    const installments = movement['installments'] as InstallmentData[] | undefined;

    if (!groupId || !paidBy || !installments) {
      throw new HttpsError('failed-precondition', 'Este gasto no tiene un plan de cuotas.');
    }
    const debtor = splits.find((split) => split.uid !== paidBy);
    if (!debtor) {
      throw new HttpsError('failed-precondition', 'No hay un deudor en este gasto.');
    }
    if (uid !== paidBy && uid !== debtor.uid) {
      throw new HttpsError('permission-denied', 'No eres parte de esta deuda.');
    }
    const installment = installments[installmentIndex];
    if (!installment) {
      throw new HttpsError('not-found', 'Esa cuota no existe.');
    }
    // Chequeo rápido, por el caso común (doble tap del mismo botón): si
    // installments[i] ya dice 'paid', ni hace falta la vuelta de abajo.
    if (installment.status === 'paid') {
      throw new HttpsError('failed-precondition', 'Esa cuota ya está pagada.');
    }

    // Chequeo real: installments[i].status puede estar DESACTUALIZADO si
    // esta cuota ya quedó cubierta por otro camino — el más probable,
    // "Marcar como saldada" auto-asignó su abono a esta misma deuda (es la
    // más antigua de la pareja) sin tocar installments[] (ese botón nunca
    // escribe el movement). Sin este chequeo, se podría pagar la misma
    // cuota dos veces. Se relee TODO movements+settlements del grupo
    // DENTRO de la transacción (tx.get soporta queries en el SDK Admin, a
    // diferencia del SDK cliente) para que Firestore reintente esta
    // transacción si algo cambia antes de escribir — misma cobertura de
    // concurrencia que createSettlement() del cliente, pero sin su ventana
    // de carrera.
    const [groupMovementsSnap, groupSettlementsSnap] = await Promise.all([
      tx.get(firestore.collection('movements').where('groupId', '==', groupId)),
      tx.get(firestore.collection('settlements').where('groupId', '==', groupId)),
    ]);
    const groupMovements = toMovementDocsForDebts(groupMovementsSnap.docs);
    const groupSettlements = toSettlementDocsForDebts(groupSettlementsSnap.docs);

    const remaining = remainingForDebt(groupMovements, groupSettlements, movementId, debtor.uid, installmentIndex);
    if (remaining < installment.amount - 0.005) {
      throw new HttpsError(
        'failed-precondition',
        'Esa cuota ya no tiene saldo pendiente — alguien ya la pagó (puede haber sido al saldar toda la deuda de un golpe).'
      );
    }

    const nextInstallments = installments.map((inst, index) =>
      index === installmentIndex ? { ...inst, status: 'paid' } : inst
    );
    const stillPending = nextInstallments.some((inst) => inst.status === 'pending');

    const now = Timestamp.now();
    tx.set(settlementRef, {
      groupId,
      fromUid: debtor.uid,
      toUid: paidBy,
      amount: installment.amount,
      date: now,
      note,
      linkedMovementId: null,
      // Abono con allocations (ver DATABASE.md, "Balance de grupo y
      // abonos"): "pagar completo" de ESTA cuota, por exactamente su monto
      // — nada que distribuir, una sola allocation. installments[i].status
      // sigue actualizándose abajo (lo lee la UI de cuotas y el recordatorio
      // de hasPendingInstallments), pero ya no es la fuente de verdad del
      // cálculo de balance (ver core/debts/debts.ts, computeDebts): esa
      // ahora es este abono.
      allocations: [{ movementId, debtorUid: debtor.uid, installmentIndex, amount: installment.amount }],
      allocationMode: 'manual',
      createdBy: uid,
      createdAt: now,
    });
    tx.update(movementRef, {
      installments: nextInstallments,
      hasPendingInstallments: stillPending,
    });

    return { settlementId: settlementRef.id };
  });
});

// Mantiene installments[i].status sincronizado con el balance real (ver
// DATABASE.md, "Balance de grupo y abonos") para cualquier camino que NO
// sea payInstallment — el más común, "Marcar como saldada"/"Abonar" desde
// el modal (SettlementsService.createSettlement(), cliente), que puede
// dejar una cuota en remaining 0 sin tocar el movement (el deudor no es su
// dueño). Se dispara con CUALQUIER escritura de un settlement (create,
// update — incluida una anulación futura: status -> 'voided' puede hacer
// que una cuota que estaba pagada vuelva a 'pending'), no solo al crearlo.
//
// No alcanza con mirar las allocations del settlement que disparó esto: un
// abono legacy (sin allocations) se auto-asigna a la deuda más antigua de
// la pareja, así que anular o crear uno puede desplazarle el pago a OTRA
// cuota que ni siquiera aparece ahí. Por eso se recalculan TODAS las
// deudas de cuota de esa pareja (cuotaDebtsForPair), no solo las
// referenciadas.
//
// No dispara notifySharedExpenseAssigned (onDocumentCreated de
// 'movements/{id}'): esa solo reacciona a la CREACIÓN de un movement,
// nunca a un update, así que tx.update() de abajo no la re-dispara. No hay
// otro trigger ni push atado a installments[]/hasPendingInstallments —
// solo el recordatorio diario (processRecurringPayments/
// remindPendingInstallments), que es un onSchedule, no reacciona a esto.
export const syncInstallmentStatus = onDocumentWritten({ document: 'settlements/{settlementId}', region: REGION }, async (event) => {
  const after = event.data?.after?.exists ? event.data.after.data() : undefined;
  const before = event.data?.before?.exists ? event.data.before.data() : undefined;
  const settlement = after ?? before;
  if (!settlement) {
    return;
  }

  const groupId = settlement['groupId'] as string | undefined;
  const fromUid = settlement['fromUid'] as string | undefined;
  const toUid = settlement['toUid'] as string | undefined;
  if (!groupId || !fromUid || !toUid) {
    return;
  }

  const firestore = getFirestore();

  await firestore.runTransaction(async (tx) => {
    const [groupMovementsSnap, groupSettlementsSnap] = await Promise.all([
      tx.get(firestore.collection('movements').where('groupId', '==', groupId)),
      tx.get(firestore.collection('settlements').where('groupId', '==', groupId)),
    ]);
    const groupMovements = toMovementDocsForDebts(groupMovementsSnap.docs);
    const groupSettlements = toSettlementDocsForDebts(groupSettlementsSnap.docs);

    const cuotaDebts = cuotaDebtsForPair(groupMovements, groupSettlements, fromUid, toUid);
    if (cuotaDebts.length === 0) {
      return;
    }

    const debtsByMovementId = new Map<string, typeof cuotaDebts>();
    for (const debt of cuotaDebts) {
      const list = debtsByMovementId.get(debt.movementId) ?? [];
      list.push(debt);
      debtsByMovementId.set(debt.movementId, list);
    }

    for (const movementSnap of groupMovementsSnap.docs) {
      const debtsForThisMovement = debtsByMovementId.get(movementSnap.id);
      if (!debtsForThisMovement) {
        continue;
      }
      const installments = movementSnap.data()['installments'] as InstallmentData[] | undefined;
      if (!installments?.length) {
        continue;
      }

      let changed = false;
      const nextInstallments = installments.map((installment, index) => {
        const debt = debtsForThisMovement.find((d) => d.installmentIndex === index);
        if (!debt) {
          return installment;
        }
        // Solo 'pending'/'paid' existen en este campo — una cuota parcial
        // se queda en 'pending' (el modelo viejo no tiene un tercer estado).
        const shouldBePaid = debt.remaining <= 0;
        const nextStatus = shouldBePaid ? 'paid' : 'pending';
        if (installment.status === nextStatus) {
          return installment;
        }
        changed = true;
        return { ...installment, status: nextStatus };
      });

      if (!changed) {
        continue;
      }
      tx.update(movementSnap.ref, {
        installments: nextInstallments,
        hasPendingInstallments: nextInstallments.some((inst) => inst.status === 'pending'),
      });
    }
  });
});

// Push al crear un abono — solo para "la otra parte" (ver
// settlement-notifications.ts): nunca para createdBy (ya sabe que lo
// registró), nunca para un tercero del grupo (un abono es cosa de dos).
// No dispara en el movimiento personal opcional que createSettlement()
// crea en el mismo batch (ver SettlementsService) — ese es un documento
// de `movements`, no de `settlements`, así que no entra a este trigger.
export const notifySettlementCreated = onDocumentCreated({ document: 'settlements/{settlementId}', region: REGION }, async (event) => {
  const snap = event.data;
  if (!snap) {
    return;
  }
  const settlement = snap.data();
  const groupId = settlement['groupId'] as string | undefined;
  const fromUid = settlement['fromUid'] as string | undefined;
  const toUid = settlement['toUid'] as string | undefined;
  const createdBy = settlement['createdBy'] as string | undefined;
  const amount = settlement['amount'] as number | undefined;
  if (!groupId || !fromUid || !toUid || !createdBy || !amount) {
    return; // abono legacy (de antes de createdBy) o dato incompleto — no hay a quién notificar con certeza.
  }

  const firestore = getFirestore();
  const [payerSnap, receiverSnap] = await Promise.all([
    firestore.collection('users').doc(fromUid).get(),
    firestore.collection('users').doc(toUid).get(),
  ]);
  const notification = buildSettlementCreatedNotification({
    fromUid,
    toUid,
    createdBy,
    amount,
    payerName: (payerSnap.data()?.['displayName'] as string | undefined) || 'Alguien',
    receiverName: (receiverSnap.data()?.['displayName'] as string | undefined) || 'alguien',
  });
  if (!notification) {
    return;
  }

  console.log(`[notifySettlementCreated] ${event.params.settlementId}: notificando a ${notification.recipientUid}`);
  await sendPushNotification(firestore, notification.recipientUid, {
    title: notification.title,
    body: notification.body,
    channelId: GROUP_ACTIVITY_CHANNEL_ID,
    data: { type: 'group-detail', groupId },
  });
});

// Push al anular un abono — solo en la transición activo -> anulado (nunca
// en la creación con status ya 'voided', que no existe, ni en cualquier
// otro update como nota/adjunto). Igual que al crear: solo "la otra
// parte", nunca voidedBy, nunca un tercero.
export const notifySettlementVoided = onDocumentUpdated({ document: 'settlements/{settlementId}', region: REGION }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) {
    return;
  }
  const wasActive = (before['status'] as string | undefined) !== 'voided';
  const isNowVoided = (after['status'] as string | undefined) === 'voided';
  if (!wasActive || !isNowVoided) {
    return;
  }

  const groupId = after['groupId'] as string | undefined;
  const fromUid = after['fromUid'] as string | undefined;
  const toUid = after['toUid'] as string | undefined;
  const voidedBy = after['voidedBy'] as string | undefined;
  const amount = after['amount'] as number | undefined;
  const voidReason = after['voidReason'] as string | undefined;
  if (!groupId || !fromUid || !toUid || !voidedBy || !amount || !voidReason) {
    return;
  }

  const firestore = getFirestore();
  const voiderSnap = await firestore.collection('users').doc(voidedBy).get();
  const notification = buildSettlementVoidedNotification({
    fromUid,
    toUid,
    voidedBy,
    amount,
    voidReason,
    voiderName: (voiderSnap.data()?.['displayName'] as string | undefined) || 'Alguien',
  });
  if (!notification) {
    return;
  }

  console.log(`[notifySettlementVoided] ${event.params.settlementId}: notificando a ${notification.recipientUid}`);
  await sendPushNotification(firestore, notification.recipientUid, {
    title: notification.title,
    body: notification.body,
    channelId: GROUP_ACTIVITY_CHANNEL_ID,
    data: { type: 'group-detail', groupId },
  });
});

// Mismo chequeo diario que los recordatorios de recurrentes (ver
// processRecurringPayments arriba) — agregado ACÁ adentro a propósito, no
// como un segundo onSchedule, para no crear un Cloud Scheduler nuevo (ver
// DATABASE.md, "Pagos a cuotas"). hasPendingInstallments es un campo
// denormalizado (ver SharedMovement) que evita traer TODOS los movements
// solo para revisar si tienen cuotas.
async function remindPendingInstallments(firestore: Firestore, reminderStart: Timestamp, reminderEnd: Timestamp): Promise<void> {
  const installmentsSnap = await firestore.collection('movements').where('hasPendingInstallments', '==', true).get();
  console.log(`[remindPendingInstallments] ${installmentsSnap.size} gasto(s) con cuotas pendientes`);

  for (const movementDoc of installmentsSnap.docs) {
    const movement = movementDoc.data();
    const groupId = movement['groupId'] as string | undefined;
    const paidBy = movement['paidBy'] as string | undefined;
    const splits = (movement['splits'] as MovementSplitForNotify[] | undefined) ?? [];
    const installments = movement['installments'] as InstallmentData[] | undefined;
    if (!groupId || !paidBy || !installments) {
      continue;
    }
    const debtor = splits.find((split) => split.uid !== paidBy);
    if (!debtor) {
      continue;
    }

    for (let index = 0; index < installments.length; index++) {
      const installment = installments[index];
      if (installment.status !== 'pending') {
        continue;
      }
      const dueMillis = installment.dueDate.toMillis();
      if (dueMillis < reminderStart.toMillis() || dueMillis >= reminderEnd.toMillis()) {
        continue;
      }
      await sendPushNotification(firestore, debtor.uid, {
        title: 'Cuota próxima a vencer',
        body: `Tu cuota ${index + 1} de ${installments.length} vence en 3 días: $${installment.amount.toLocaleString('es-CO')}`,
        channelId: RECURRING_PAYMENTS_CHANNEL_ID,
        data: { type: 'group-detail', groupId },
      });
    }
  }
}

// Mismo chequeo diario que los recordatorios de arriba — agregado ACÁ
// adentro a propósito, no como un segundo onSchedule (ver
// remindPendingInstallments). Un solo filtro de rango sobre
// nextReminderDate basta, sin necesitar un índice compuesto ni un segundo
// filtro por type: ningún otro type de grupo llega a tener ese campo (ver
// group.model.ts), así que el resultado ya viene acotado a metas con
// recordatorio configurado. Notifica a TODOS los miembros del grupo (una
// meta puede ser personal o compartida) y avanza nextReminderDate con la
// misma advanceNextDate que ya usan los recurrentes.
async function remindSavingsGoalContributions(firestore: Firestore, now: Timestamp): Promise<void> {
  const dueSnap = await firestore.collection('groups').where('nextReminderDate', '<=', now).get();
  console.log(`[remindSavingsGoalContributions] ${dueSnap.size} meta(s) con recordatorio de aporte vencido`);

  for (const groupDoc of dueSnap.docs) {
    const group = groupDoc.data();
    const frequency = group['reminderFrequency'] as string | undefined;
    const members = (group['members'] as string[] | undefined) ?? [];
    const nextReminderDate = group['nextReminderDate'] as Timestamp | undefined;
    if (!frequency || !nextReminderDate || members.length === 0) {
      continue;
    }

    const name = (group['name'] as string) ?? 'tu meta';
    const suggestedAmount = group['reminderSuggestedAmount'] as number | null | undefined;
    const body = suggestedAmount
      ? `Hora de aportar a "${name}" — monto sugerido: $${suggestedAmount.toLocaleString('es-CO')}`
      : `Hora de aportar a tu meta "${name}"`;

    await Promise.all(
      members.map((uid) =>
        sendPushNotification(firestore, uid, {
          title: 'Aporte a tu meta de ahorro',
          body,
          channelId: SAVINGS_GOAL_CHANNEL_ID,
          data: { type: 'group-detail', groupId: groupDoc.id },
        })
      )
    );

    const newNextDate = advanceNextDate(nextReminderDate.toDate(), frequency);
    await groupDoc.ref.update({ nextReminderDate: Timestamp.fromDate(newNextDate) });
  }
}
