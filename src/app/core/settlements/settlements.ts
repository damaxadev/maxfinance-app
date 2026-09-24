import { Injectable, inject } from '@angular/core';
import { Observable, catchError, combineLatest, firstValueFrom, map, of, switchMap } from 'rxjs';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  getCountFromServer,
  getDocs,
  increment,
  query,
  where,
  type WriteBatch,
  writeBatch,
} from '@angular/fire/firestore';

import { Auth } from '../auth/auth';
import { Categories } from '../categories/categories';
import type { PersonalMovement } from '../../models/movement.model';
import type { Settlement } from '../../models/settlement.model';

export type SettlementWithId = Settlement & { id: string };

export interface SettlementFormValue {
  groupId: string;
  fromUid: string;
  toUid: string;
  amount: number;
  note: string;
  // Presente solo si se marcó "Registrar también como movimiento personal".
  personalMovementAccountId: string | null;
}

// Nombres fijos de las categorías base usadas al convertir un settlement en
// movimiento personal — ver DATABASE.md. No son elegibles por el usuario,
// se resuelven automáticamente según si pagó o recibió.
const DEBT_PAYMENT_CATEGORY_NAME = 'Pago de deuda';
const OTHER_INCOME_CATEGORY_NAME = 'Otros ingresos';

@Injectable({
  providedIn: 'root',
})
export class SettlementsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly categories = inject(Categories);

  // groupId es un filtro de igualdad (constante conocida), así que Firestore
  // puede probar isGroupMember(groupId) estáticamente para toda la lista.
  settlements$(groupId: string): Observable<SettlementWithId[]> {
    return this.auth.currentUser$.pipe(
      switchMap((user) => {
        if (!user) {
          return of([]);
        }
        const settlementsQuery = query(collection(this.firestore, 'settlements'), where('groupId', '==', groupId));
        return collectionData(settlementsQuery, { idField: 'id' }) as Observable<SettlementWithId[]>;
      }),
      catchError((error) => {
        console.error('Error al cargar los settlements del grupo', error);
        return of([]);
      })
    );
  }

  // Settlements de varios grupos a la vez — un query por grupo (mismo
  // criterio que MovementsService.allSharedMovementsForGroups$: cada uno
  // sigue siendo un filtro de igualdad sobre una constante conocida, provable
  // por la regla). Usado por GroupActivity cuando recibe más de un groupId
  // (ver Inicio, "Gastos compartidos recientes").
  settlementsForGroups$(groupIds: string[]): Observable<SettlementWithId[]> {
    return this.auth.currentUser$.pipe(
      switchMap((user) => {
        if (!user || groupIds.length === 0) {
          return of([]);
        }
        const queries$ = groupIds.map((groupId) => this.settlements$(groupId));
        return combineLatest(queries$).pipe(map((lists) => lists.flat()));
      }),
      catchError((error) => {
        console.error('Error al cargar los settlements de los grupos', error);
        return of([]);
      })
    );
  }

  async create(value: SettlementFormValue): Promise<void> {
    const uid = this.requireUid();
    const batch = writeBatch(this.firestore);
    const now = Timestamp.fromDate(new Date());

    const settlementRef = doc(collection(this.firestore, 'settlements'));
    const isPayer = uid === value.fromUid;

    let linkedMovementId: string | null = null;
    if (value.personalMovementAccountId) {
      linkedMovementId = await this.appendLinkedMovement(batch, {
        settlementId: settlementRef.id,
        uid,
        isPayer,
        accountId: value.personalMovementAccountId,
        amount: value.amount,
        note: value.note,
        date: now,
      });
    }

    const settlement: Settlement = {
      groupId: value.groupId,
      fromUid: value.fromUid,
      toUid: value.toUid,
      amount: value.amount,
      date: now,
      note: value.note,
      linkedMovementId,
    };
    batch.set(settlementRef, settlement);

    await batch.commit();
  }

  // Convierte un settlement YA EXISTENTE en movimiento personal, de forma
  // independiente de si el otro lado (o este mismo, al crearlo) ya lo hizo.
  // No se toca el settlement ni su linkedMovementId: DATABASE.md es explícito
  // en que esa relación se deriva consultando movements, no se guarda un mapa
  // de "quién ya convirtió el suyo".
  async linkPersonalMovement(settlement: SettlementWithId, accountId: string): Promise<void> {
    const uid = this.requireUid();
    const batch = writeBatch(this.firestore);

    await this.appendLinkedMovement(batch, {
      settlementId: settlement.id,
      uid,
      isPayer: uid === settlement.fromUid,
      accountId,
      amount: settlement.amount,
      note: settlement.note,
      date: Timestamp.fromDate(new Date()),
    });

    await batch.commit();
  }

  // ¿Ya existe un movimiento personal de ESTE usuario vinculado a cada uno
  // de estos settlements? groupId == null hace la lectura provable contra
  // la regla (misma razón que personalMovements$) — sin ese filtro, Firestore
  // no podría descartar que algún resultado cayera en la rama de grupo.
  async findLinkedMovementSettlementIds(settlementIds: string[], uid: string): Promise<Set<string>> {
    if (settlementIds.length === 0) {
      return new Set();
    }
    // 'in' acepta hasta 30 valores — de sobra para el historial (~10) y para
    // la vista "ver todos", que tampoco crece más allá de unas decenas.
    const chunks: string[][] = [];
    for (let i = 0; i < settlementIds.length; i += 30) {
      chunks.push(settlementIds.slice(i, i + 30));
    }

    const results = await Promise.all(
      chunks.map(async (ids) => {
        const linkedQuery = query(
          collection(this.firestore, 'movements'),
          where('settlementId', 'in', ids),
          where('uid', '==', uid),
          where('groupId', '==', null)
        );
        const snapshot = await getDocs(linkedQuery);
        return snapshot.docs.map((d) => d.data()['settlementId'] as string);
      })
    );

    return new Set(results.flat());
  }

  // Conteo total (no reactivo) — mismo propósito que countGroupMovements.
  async countGroupSettlements(groupId: string): Promise<number> {
    const snapshot = await getCountFromServer(
      query(collection(this.firestore, 'settlements'), where('groupId', '==', groupId))
    );
    return snapshot.data().count;
  }

  private async appendLinkedMovement(
    batch: WriteBatch,
    params: {
      settlementId: string;
      uid: string;
      isPayer: boolean;
      accountId: string;
      amount: number;
      note: string;
      date: Timestamp;
    }
  ): Promise<string> {
    const categoryName = params.isPayer ? DEBT_PAYMENT_CATEGORY_NAME : OTHER_INCOME_CATEGORY_NAME;
    const categoryId = await this.findBaseCategoryId(categoryName);

    const movementRef = doc(collection(this.firestore, 'movements'));
    const movement: PersonalMovement = {
      uid: params.uid,
      accountId: params.accountId,
      categoryId,
      type: params.isPayer ? 'expense' : 'income',
      amount: params.amount,
      date: params.date,
      note: params.note,
      groupId: null,
      settlementId: params.settlementId,
    };
    batch.set(movementRef, movement);

    const accountRef = doc(this.firestore, 'accounts', params.accountId);
    batch.update(accountRef, { balance: increment(params.isPayer ? -params.amount : params.amount) });

    return movementRef.id;
  }

  private async findBaseCategoryId(name: string): Promise<string> {
    const categories = await firstValueFrom(this.categories.categories$);
    const match = categories.find((category) => category.uid === null && category.name === name);
    if (!match) {
      throw new Error(`No encontramos la categoría base "${name}". Corre scripts/seed-categories.mjs de nuevo.`);
    }
    return match.id;
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No hay un usuario autenticado.');
    }
    return uid;
  }
}
