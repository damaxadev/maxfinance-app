import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, switchMap } from 'rxjs';
import { Firestore, collection, collectionData, deleteDoc, doc, query, setDoc, where } from '@angular/fire/firestore';

import { Auth } from '../auth/auth';
import type { Budget } from '../../models/budget.model';

export type BudgetWithId = Budget & { id: string };

export interface BudgetFormValue {
  categoryId: string;
  month: string;
  limit: number;
}

@Injectable({
  providedIn: 'root',
})
export class Budgets {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  // uid + month son ambos filtros de igualdad, así que no requieren índice
  // compuesto (mismo criterio que personalMovements$).
  budgetsForMonth$(month: string): Observable<BudgetWithId[]> {
    return this.auth.currentUser$.pipe(
      switchMap((user) => {
        if (!user) {
          return of([]);
        }
        const budgetsQuery = query(
          collection(this.firestore, 'budgets'),
          where('uid', '==', user.uid),
          where('month', '==', month)
        );
        return collectionData(budgetsQuery, { idField: 'id' }) as Observable<BudgetWithId[]>;
      }),
      catchError((error) => {
        console.error('Error al cargar el presupuesto', error);
        return of([]);
      })
    );
  }

  // Id determinístico (uid_categoryId_month) en vez de uno autogenerado:
  // así setDoc() sobreescribe el mismo documento en vez de crear uno nuevo
  // cada vez que se edita el límite de la misma categoría/mes — evita tener
  // que consultar primero si ya existe uno para hacer un update en su lugar.
  async setLimit(value: BudgetFormValue): Promise<void> {
    const uid = this.requireUid();
    const ref = doc(this.firestore, 'budgets', `${uid}_${value.categoryId}_${value.month}`);
    const budget: Budget = { uid, categoryId: value.categoryId, month: value.month, limit: value.limit };
    await setDoc(ref, budget);
  }

  // Quitar una categoría del presupuesto (opt-in, Fase 7): no hay que
  // preservar ningún historial especial — los budgets ya son por mes, así
  // que borrar el doc de uno no afecta a los de meses anteriores/futuros.
  async removeLimit(categoryId: string, month: string): Promise<void> {
    const uid = this.requireUid();
    await deleteDoc(doc(this.firestore, 'budgets', `${uid}_${categoryId}_${month}`));
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No hay un usuario autenticado.');
    }
    return uid;
  }
}
