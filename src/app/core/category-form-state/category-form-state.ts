import { Injectable, signal } from '@angular/core';

import type { CategoryWithId } from '../categories/categories';
import type { CategorySaved } from '../../features/categories/category-form/category-form';

export type CategoryFormRequest = { mode: 'create' } | { mode: 'edit'; category: CategoryWithId };

/**
 * Estado compartido del modal de "agregar/editar categoría" — mismo motivo
 * que AccountFormState: el modal se renderiza a nivel de Shell, no dentro
 * del <swiper-slide> de Ajustes (ver comentario en AccountFormState).
 *
 * lastSaved permite que quien abrió el modal desde otro árbol de componentes
 * (p. ej. el selector de categoría del formulario de movimiento, vía la
 * opción "+ Nueva categoría") se entere de qué categoría se acaba de crear,
 * sin que Shell (quien realmente renderiza el modal) tenga que conocer a
 * ese consumidor. Quien lo consume debe llamar clearLastSaved() para no
 * reaccionar de nuevo ante un valor ya leído.
 */
@Injectable({
  providedIn: 'root',
})
export class CategoryFormState {
  private readonly _request = signal<CategoryFormRequest | null>(null);
  readonly request = this._request.asReadonly();

  private readonly _lastSaved = signal<CategorySaved | null>(null);
  readonly lastSaved = this._lastSaved.asReadonly();

  openCreate(): void {
    this._request.set({ mode: 'create' });
  }

  openEdit(category: CategoryWithId): void {
    this._request.set({ mode: 'edit', category });
  }

  close(saved?: CategorySaved): void {
    this._request.set(null);
    if (saved) {
      this._lastSaved.set(saved);
    }
  }

  clearLastSaved(): void {
    this._lastSaved.set(null);
  }
}
