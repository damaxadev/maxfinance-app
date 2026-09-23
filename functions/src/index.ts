import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();

// Misma región que Firestore (ver firebase.json) — evita latencia entre
// regiones y mantiene todo el proyecto en un solo lugar.
const REGION = 'us-east1';

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
