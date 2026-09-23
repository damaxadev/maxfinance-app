import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, switchMap } from 'rxjs';
import {
  Firestore,
  addDoc,
  arrayRemove,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Functions, httpsCallable, type HttpsCallable } from '@angular/fire/functions';

import { Auth } from '../auth/auth';
import type { Group } from '../../models/group.model';

export type GroupWithId = Group & { id: string };

export interface GroupMemberProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

@Injectable({
  providedIn: 'root',
})
export class GroupsService {
  private readonly firestore = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly auth = inject(Auth);

  readonly groups$: Observable<GroupWithId[]> = this.auth.currentUser$.pipe(
    switchMap((user) => {
      if (!user) {
        return of([]);
      }
      const groupsQuery = query(collection(this.firestore, 'groups'), where('members', 'array-contains', user.uid));
      return collectionData(groupsQuery, { idField: 'id' }) as Observable<GroupWithId[]>;
    }),
    catchError((error) => {
      console.error('Error al cargar los grupos', error);
      return of([]);
    })
  );

  async create(name: string): Promise<string> {
    const uid = this.requireUid();
    const newGroup: Omit<Group, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
      name,
      members: [uid],
      createdBy: uid,
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(this.firestore, 'groups'), newGroup);
    return ref.id;
  }

  // Sale del grupo uno mismo — corre server-side (Cloud Function) porque la
  // regla de Firestore de groups solo permite update a createdBy/admin.
  async leave(groupId: string): Promise<void> {
    const callable = httpsCallable<{ groupId: string }, { success: true }>(this.functions, 'leaveGroup');
    await this.callOrTranslate(callable, { groupId });
  }

  // Eliminar a OTRO miembro sí lo permite la regla existente (isOwner(createdBy)),
  // así que esto se hace directo contra Firestore, sin pasar por una function.
  async removeMember(groupId: string, memberUid: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'groups', groupId), { members: arrayRemove(memberUid) });
  }

  // Elimina el grupo completo (solo createdBy/admin — ya lo exige la regla
  // de Firestore, no hace falta una Cloud Function). Antes verifica que no
  // tenga gastos compartidos registrados: antes de Fase 5 esto nunca se
  // dispara (no existen movements/settlements de grupo todavía), pero la
  // guarda queda lista para cuando sí existan.
  async remove(groupId: string): Promise<void> {
    const [movementsSnap, settlementsSnap] = await Promise.all([
      getDocs(query(collection(this.firestore, 'movements'), where('groupId', '==', groupId), limit(1))),
      getDocs(query(collection(this.firestore, 'settlements'), where('groupId', '==', groupId), limit(1))),
    ]);

    if (!movementsSnap.empty || !settlementsSnap.empty) {
      throw new Error('No puedes eliminar un grupo con gastos registrados.');
    }

    await deleteDoc(doc(this.firestore, 'groups', groupId));
  }

  async inviteByEmail(groupId: string, email: string): Promise<void> {
    const callable = httpsCallable<{ groupId: string; email: string }, { uid: string }>(
      this.functions,
      'inviteGroupMember'
    );
    await this.callOrTranslate(callable, { groupId, email });
  }

  // Invita a alguien cuyo uid ya conocemos (chip de un contacto sugerido
  // en GroupDetail) — evita el viaje redundante de resolverlo por email.
  async inviteByUid(groupId: string, uid: string): Promise<void> {
    const callable = httpsCallable<{ groupId: string; uid: string }, { uid: string }>(
      this.functions,
      'inviteGroupMember'
    );
    await this.callOrTranslate(callable, { groupId, uid });
  }

  async getMemberProfiles(groupId: string): Promise<GroupMemberProfile[]> {
    const callable = httpsCallable<{ groupId: string }, GroupMemberProfile[]>(this.functions, 'getGroupMembers');
    return this.callOrTranslate(callable, { groupId });
  }

  // Sugerencias de "gente que ya conoces" — solo con quien ya se comparte
  // un grupo (ver functions/src/index.ts, getKnownContacts, y la decisión
  // de privacidad en DATABASE.md). Vacía si el usuario no está en ningún
  // grupo todavía; es normal, no un error.
  async getKnownContacts(): Promise<GroupMemberProfile[]> {
    const callable = httpsCallable<undefined, GroupMemberProfile[]>(this.functions, 'getKnownContacts');
    return this.callOrTranslate(callable, undefined);
  }

  private async callOrTranslate<Req, Res>(callable: HttpsCallable<Req, Res>, data: Req): Promise<Res> {
    try {
      const result = await callable(data);
      return result.data;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Ocurrió un error inesperado.');
    }
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No hay un usuario autenticado.');
    }
    return uid;
  }
}
