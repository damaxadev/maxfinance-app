import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, switchMap } from 'rxjs';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';

import { Auth } from '../auth/auth';
import type { Account, AccountType } from '../../models/account.model';

export type AccountWithId = Account & { id: string };

export interface AccountFormValue {
  name: string;
  type: AccountType;
}

@Injectable({
  providedIn: 'root',
})
export class Accounts {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  readonly accounts$: Observable<AccountWithId[]> = this.auth.currentUser$.pipe(
    switchMap((user) => {
      if (!user) {
        return of([]);
      }
      const accountsQuery = query(collection(this.firestore, 'accounts'), where('uid', '==', user.uid));
      return collectionData(accountsQuery, { idField: 'id' }) as Observable<AccountWithId[]>;
    }),
    catchError((error) => {
      console.error('Error al cargar las cuentas', error);
      return of([]);
    })
  );

  async create(value: AccountFormValue): Promise<string> {
    const uid = this.requireUid();
    const newAccount: Account = {
      uid,
      name: value.name,
      type: value.type,
      balance: 0,
      currency: 'COP',
    };
    const ref = await addDoc(collection(this.firestore, 'accounts'), newAccount);
    return ref.id;
  }

  async update(id: string, value: AccountFormValue): Promise<void> {
    await updateDoc(doc(this.firestore, 'accounts', id), {
      name: value.name,
      type: value.type,
    });
  }

  async remove(id: string): Promise<void> {
    const uid = this.requireUid();
    const linkedMovements = await getDocs(
      query(collection(this.firestore, 'movements'), where('uid', '==', uid), where('accountId', '==', id), limit(1))
    );
    if (!linkedMovements.empty) {
      throw new Error('No puedes eliminar una cuenta con movimientos. Elimina esos movimientos primero.');
    }
    await deleteDoc(doc(this.firestore, 'accounts', id));
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No hay un usuario autenticado.');
    }
    return uid;
  }
}
