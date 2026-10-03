import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, switchMap } from 'rxjs';
import {
  Firestore,
  Timestamp,
  addDoc,
  arrayRemove,
  arrayUnion,
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
import type { GoalMode, GoalReminderFrequency, Group, GroupType } from '../../models/group.model';

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

  async create(name: string, type: GroupType): Promise<string> {
    const uid = this.requireUid();
    const newGroup: Omit<Group, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
      name,
      members: [uid],
      createdBy: uid,
      createdAt: serverTimestamp(),
      type,
    };
    const ref = await addDoc(collection(this.firestore, 'groups'), newGroup);
    return ref.id;
  }

  // Meta de ahorro (type: 'savings', ver DATABASE.md) — un grupo normal más
  // los campos de la meta. goalMode es fijo de por vida (ver GoalForm):
  // 'target' guarda targetAmount y deja celebrationAmount en null; 'open-
  // ended' es al revés. nextReminderDate se fija a "ahora" (no a "un ciclo
  // después") si hay reminderFrequency — mismo criterio que
  // RecurringPaymentForm: el primer aviso puede caer en la corrida diaria
  // siguiente, el resto de los avances los calcula la Cloud Function
  // (advanceNextDate, ver remindSavingsGoalContributions).
  async createGoal(input: {
    name: string;
    goalMode: GoalMode;
    targetAmount: number | null;
    celebrationAmount: number | null;
    targetDate: Date | null;
    reminderFrequency: GoalReminderFrequency | null;
    reminderSuggestedAmount: number | null;
  }): Promise<string> {
    const uid = this.requireUid();
    const newGoal: Omit<Group, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
      name: input.name,
      members: [uid],
      createdBy: uid,
      createdAt: serverTimestamp(),
      type: 'savings',
      goalMode: input.goalMode,
      targetAmount: input.goalMode === 'target' ? (input.targetAmount ?? 0) : null,
      celebrationAmount: input.goalMode === 'open-ended' ? (input.celebrationAmount ?? 0) : null,
      reachedMilestones: [],
      targetDate: input.targetDate ? Timestamp.fromDate(input.targetDate) : null,
      reminderFrequency: input.reminderFrequency,
      reminderSuggestedAmount: input.reminderFrequency ? input.reminderSuggestedAmount : null,
      nextReminderDate: input.reminderFrequency ? Timestamp.now() : null,
    };
    const ref = await addDoc(collection(this.firestore, 'groups'), newGoal);
    return ref.id;
  }

  // Confetti de una meta (ver GoalEntryForm) — una sola vez en la vida de
  // la meta por hito, sin importar que el progreso baje y vuelva a subir.
  // arrayUnion, mismo patrón que members (removeMember más abajo): un
  // array en el propio doc del grupo, mutado directo desde el cliente. La
  // regla de Firestore permite esto a CUALQUIER miembro (no solo
  // createdBy) siempre que el único campo que cambie sea reachedMilestones
  // — quien registra el aporte que cruza el hito es quien lo celebra, no
  // necesariamente quien creó la meta.
  async markMilestonesReached(groupId: string, milestones: number[]): Promise<void> {
    if (milestones.length === 0) {
      return;
    }
    await updateDoc(doc(this.firestore, 'groups', groupId), { reachedMilestones: arrayUnion(...milestones) });
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

  // Mismo permiso que removeMember (isOwner(createdBy) || isAdmin()) — update
  // directo contra Firestore, sin Cloud Function.
  async rename(groupId: string, name: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'groups', groupId), { name });
  }

  // Elimina el grupo completo (solo createdBy/admin — ya lo exige la regla
  // de Firestore, no hace falta una Cloud Function). Antes verifica que no
  // tenga gastos compartidos registrados: antes de Fase 5 esto nunca se
  // dispara (no existen movements/settlements de grupo todavía), pero la
  // guarda queda lista para cuando sí existan. goalEntries es el mismo
  // chequeo para una meta de ahorro (ver DATABASE.md) — un ledger aparte,
  // no movements/settlements.
  async remove(groupId: string): Promise<void> {
    const [movementsSnap, settlementsSnap, goalEntriesSnap] = await Promise.all([
      getDocs(query(collection(this.firestore, 'movements'), where('groupId', '==', groupId), limit(1))),
      getDocs(query(collection(this.firestore, 'settlements'), where('groupId', '==', groupId), limit(1))),
      getDocs(query(collection(this.firestore, 'goalEntries'), where('groupId', '==', groupId), limit(1))),
    ]);

    if (!movementsSnap.empty || !settlementsSnap.empty || !goalEntriesSnap.empty) {
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
