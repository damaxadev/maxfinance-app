import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  increment,
  query,
  where,
  writeBatch,
} from '@angular/fire/firestore';

import { Auth } from '../auth/auth';
import type { MovementType, PersonalMovement } from '../../models/movement.model';

export type PersonalMovementWithId = PersonalMovement & { id: string };

export interface MovementFormValue {
  type: MovementType;
  amount: number;
  accountId: string;
  categoryId: string;
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
