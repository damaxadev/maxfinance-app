import { Injectable, inject } from '@angular/core';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  getCountFromServer,
  increment,
  query,
  where,
  writeBatch,
} from '@angular/fire/firestore';

import { Auth } from '../auth/auth';
import type { MovementSplit, MovementType, PersonalMovement, SharedMovement, SplitType } from '../../models/movement.model';

export type PersonalMovementWithId = PersonalMovement & { id: string };
export type SharedMovementWithId = SharedMovement & { id: string };

export interface MovementFormValue {
  type: MovementType;
  amount: number;
  accountId: string;
  categoryId: string;
  date: Date;
  note: string;
}

export interface SharedMovementFormValue {
  groupId: string;
  paidBy: string;
  amount: number;
  // null cuando paidBy no es quien registra el movimiento — no hay ninguna
  // cuenta de otro miembro que se pueda leer o tocar (siempre privadas).
  accountId: string | null;
  categoryId: string;
  splitType: SplitType;
  splits: MovementSplit[];
  date: Date;
  note: string;
}

function signedAmount(type: MovementType, amount: number): number {
  return type === 'income' ? amount : -amount;
}

@Injectable({
  providedIn: 'root',
})
export class MovementsService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  // uid + groupId==null son ambos filtros de igualdad, así que no requieren
  // índice compuesto. El filtro por groupId es obligatorio: la regla de
  // Firestore para 'movements' se ramifica según groupId (personal vs.
  // grupo), y sin acotarlo en la query, Firestore no puede probar
  // estáticamente que la lista completa cae en la rama de isOwner() y
  // rechaza la consulta entera con permission-denied.
  readonly personalMovements$: Observable<PersonalMovementWithId[]> = this.auth.currentUser$.pipe(
    switchMap((user) => {
      if (!user) {
        return of([]);
      }
      const movementsQuery = query(
        collection(this.firestore, 'movements'),
        where('uid', '==', user.uid),
        where('groupId', '==', null)
      );
      return collectionData(movementsQuery, { idField: 'id' }) as Observable<PersonalMovementWithId[]>;
    }),
    map((movements) => [...movements].sort((a, b) => b.date.toMillis() - a.date.toMillis())),
    catchError((error) => {
      console.error('Error al cargar los movimientos personales', error);
      return of([]);
    })
  );

  async create(value: MovementFormValue): Promise<void> {
    const uid = this.requireUid();
    const batch = writeBatch(this.firestore);

    const movementRef = doc(collection(this.firestore, 'movements'));
    const movement: PersonalMovement = {
      uid,
      accountId: value.accountId,
      categoryId: value.categoryId,
      type: value.type,
      amount: value.amount,
      date: Timestamp.fromDate(value.date),
      note: value.note,
      groupId: null,
    };
    batch.set(movementRef, movement);

    const accountRef = doc(this.firestore, 'accounts', value.accountId);
    batch.update(accountRef, { balance: increment(signedAmount(value.type, value.amount)) });

    await batch.commit();
  }

  // Movements compartidos de un grupo — usados por el cálculo de balance y
  // por la lista de gastos del grupo. groupId es un filtro de igualdad
  // (constante conocida), así que Firestore puede probar estáticamente que
  // toda la lista cae en la rama isGroupMember() de la regla — sin esto,
  // rechazaría la consulta entera (mismo motivo que personalMovements$).
  groupMovements$(groupId: string): Observable<SharedMovementWithId[]> {
    return this.auth.currentUser$.pipe(
      switchMap((user) => {
        if (!user) {
          return of([]);
        }
        const movementsQuery = query(collection(this.firestore, 'movements'), where('groupId', '==', groupId));
        return collectionData(movementsQuery, { idField: 'id' }) as Observable<SharedMovementWithId[]>;
      }),
      catchError((error) => {
        console.error('Error al cargar los movimientos del grupo', error);
        return of([]);
      })
    );
  }

  // Gastos compartidos que el usuario registró (uid == usuario) en cada uno
  // de sus grupos — usados por la vista de Movimientos para mostrarlos junto
  // a los personales. Un query por grupo, no where('groupId','in',groupIds):
  // así cada uno sigue siendo un filtro de igualdad sobre una constante
  // conocida, provable por la regla, y evitamos cualquier duda sobre cómo
  // Firestore prueba estáticamente una cláusula 'in' contra isGroupMember().
  sharedMovementsForGroups$(groupIds: string[]): Observable<SharedMovementWithId[]> {
    return this.auth.currentUser$.pipe(
      switchMap((user) => {
        if (!user || groupIds.length === 0) {
          return of([]);
        }
        const queries$ = groupIds.map((groupId) => {
          const movementsQuery = query(
            collection(this.firestore, 'movements'),
            where('uid', '==', user.uid),
            where('groupId', '==', groupId)
          );
          return collectionData(movementsQuery, { idField: 'id' }) as Observable<SharedMovementWithId[]>;
        });
        return combineLatest(queries$).pipe(map((lists) => lists.flat()));
      }),
      catchError((error) => {
        console.error('Error al cargar los gastos compartidos del usuario', error);
        return of([]);
      })
    );
  }

  // Conteo total (no reactivo, no trae los documentos) — usado por el
  // historial de actividad del grupo para saber si hay más de los ~10 que
  // ya muestra sin tener que descargarlos todos.
  async countGroupMovements(groupId: string): Promise<number> {
    const snapshot = await getCountFromServer(
      query(collection(this.firestore, 'movements'), where('groupId', '==', groupId))
    );
    return snapshot.data().count;
  }

  async createShared(value: SharedMovementFormValue): Promise<void> {
    const uid = this.requireUid();
    const batch = writeBatch(this.firestore);

    const movementRef = doc(collection(this.firestore, 'movements'));
    const movement: SharedMovement = {
      uid,
      categoryId: value.categoryId,
      type: 'expense',
      amount: value.amount,
      date: Timestamp.fromDate(value.date),
      note: value.note,
      groupId: value.groupId,
      paidBy: value.paidBy,
      splitType: value.splitType,
      splits: value.splits,
      accountId: value.accountId,
    };
    batch.set(movementRef, movement);

    // Solo se toca el balance de una cuenta si quien pagó es quien registra
    // el movimiento — la cuenta de otro miembro es privada, no la vemos ni
    // la podríamos actualizar (la regla de accounts tampoco lo permitiría).
    if (value.accountId) {
      const accountRef = doc(this.firestore, 'accounts', value.accountId);
      batch.update(accountRef, { balance: increment(-value.amount) });
    }

    await batch.commit();
  }

  async update(id: string, previous: PersonalMovement, next: MovementFormValue): Promise<void> {
    const batch = writeBatch(this.firestore);

    const movementRef = doc(this.firestore, 'movements', id);
    batch.update(movementRef, {
      accountId: next.accountId,
      categoryId: next.categoryId,
      type: next.type,
      amount: next.amount,
      date: Timestamp.fromDate(next.date),
      note: next.note,
    });

    const oldSigned = signedAmount(previous.type, previous.amount);
    const newSigned = signedAmount(next.type, next.amount);

    if (previous.accountId === next.accountId) {
      batch.update(doc(this.firestore, 'accounts', next.accountId), {
        balance: increment(newSigned - oldSigned),
      });
    } else {
      batch.update(doc(this.firestore, 'accounts', previous.accountId), { balance: increment(-oldSigned) });
      batch.update(doc(this.firestore, 'accounts', next.accountId), { balance: increment(newSigned) });
    }

    await batch.commit();
  }

  async remove(id: string, movement: PersonalMovement): Promise<void> {
    const batch = writeBatch(this.firestore);

    batch.delete(doc(this.firestore, 'movements', id));
    batch.update(doc(this.firestore, 'accounts', movement.accountId), {
      balance: increment(-signedAmount(movement.type, movement.amount)),
    });

    await batch.commit();
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No hay un usuario autenticado.');
    }
    return uid;
  }
}
