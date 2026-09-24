import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, switchMap } from 'rxjs';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';

import { Auth } from '../auth/auth';
import type { PersonalRecurringPayment } from '../../models/recurring-payment.model';

export type PersonalRecurringPaymentWithId = PersonalRecurringPayment & { id: string };

export interface RecurringPaymentFormValue {
  name: string;
  amount: number;
  categoryId: string;
  accountId: string;
  frequency: 'monthly' | 'weekly';
  nextDate: Date;
  active: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class RecurringPayments {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  // uid + groupId==null: mismo motivo que personalMovements$ — la regla de
  // recurringPayments distingue personal (uid != null) de grupo (uid ==
  // null), así que hay que acotar ambos campos para que sea provable.
  readonly personalRecurringPayments$: Observable<PersonalRecurringPaymentWithId[]> = this.auth.currentUser$.pipe(
    switchMap((user) => {
      if (!user) {
        return of([]);
      }
      const paymentsQuery = query(
        collection(this.firestore, 'recurringPayments'),
        where('uid', '==', user.uid),
        where('groupId', '==', null)
      );
      return collectionData(paymentsQuery, { idField: 'id' }) as Observable<PersonalRecurringPaymentWithId[]>;
    }),
    catchError((error) => {
      console.error('Error al cargar los pagos recurrentes', error);
      return of([]);
    })
  );

  async create(value: RecurringPaymentFormValue): Promise<void> {
    const uid = this.requireUid();
    const payment: PersonalRecurringPayment = {
      uid,
      groupId: null,
      name: value.name,
      amount: value.amount,
      categoryId: value.categoryId,
      accountId: value.accountId,
      frequency: value.frequency,
      nextDate: Timestamp.fromDate(value.nextDate),
      active: value.active,
    };
    await addDoc(collection(this.firestore, 'recurringPayments'), payment);
  }

  async update(id: string, value: RecurringPaymentFormValue): Promise<void> {
    await updateDoc(doc(this.firestore, 'recurringPayments', id), {
      name: value.name,
      amount: value.amount,
      categoryId: value.categoryId,
      accountId: value.accountId,
      frequency: value.frequency,
      nextDate: Timestamp.fromDate(value.nextDate),
      active: value.active,
    });
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, 'recurringPayments', id));
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No hay un usuario autenticado.');
    }
    return uid;
  }
}
