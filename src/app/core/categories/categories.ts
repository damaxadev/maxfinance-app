import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, switchMap } from 'rxjs';
import {
  Firestore,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  or,
  query,
  updateDoc,
  where,
} from '@angular/fire/firestore';

import { Auth } from '../auth/auth';
import type { Category, CategoryType } from '../../models/category.model';

export type CategoryWithId = Category & { id: string };

export interface CategoryFormValue {
  name: string;
  icon: string;
  type: CategoryType;
}

@Injectable({
  providedIn: 'root',
})
export class Categories {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  // Categorías base (uid == null, sembradas vía script de admin) + las
  // personalizadas del usuario actual.
  readonly categories$: Observable<CategoryWithId[]> = this.auth.currentUser$.pipe(
    switchMap((user) => {
      if (!user) {
        return of([]);
      }
      const categoriesQuery = query(
        collection(this.firestore, 'categories'),
        or(where('uid', '==', null), where('uid', '==', user.uid))
      );
      return collectionData(categoriesQuery, { idField: 'id' }) as Observable<CategoryWithId[]>;
    }),
    catchError((error) => {
      console.error('Error al cargar las categorías', error);
      return of([]);
    })
  );

  async create(value: CategoryFormValue): Promise<string> {
    const uid = this.requireUid();
    const newCategory: Category = {
      uid,
      name: value.name,
      icon: value.icon,
      type: value.type,
    };
    const ref = await addDoc(collection(this.firestore, 'categories'), newCategory);
    return ref.id;
  }

  async update(id: string, value: CategoryFormValue): Promise<void> {
    await updateDoc(doc(this.firestore, 'categories', id), {
      name: value.name,
      icon: value.icon,
      type: value.type,
    });
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(this.firestore, 'categories', id));
  }

  private requireUid(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      throw new Error('No hay un usuario autenticado.');
    }
    return uid;
  }
}
