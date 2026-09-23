import { Injectable, signal } from '@angular/core';

import type { CategoryWithId } from '../categories/categories';

export type CategoryFormRequest = { mode: 'create' } | { mode: 'edit'; category: CategoryWithId };

/**
 * Estado compartido del modal de "agregar/editar categoría" — mismo motivo
 * que AccountFormState: el modal se renderiza a nivel de Shell, no dentro
 * del <swiper-slide> de Ajustes (ver comentario en AccountFormState).
 */
@Injectable({
  providedIn: 'root',
})
export class CategoryFormState {
  private readonly _request = signal<CategoryFormRequest | null>(null);
  readonly request = this._request.asReadonly();

  openCreate(): void {
    this._request.set({ mode: 'create' });
  }

  openEdit(category: CategoryWithId): void {
    this._request.set({ mode: 'edit', category });
  }

  close(): void {
    this._request.set(null);
  }
}
