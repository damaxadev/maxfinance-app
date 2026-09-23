import { Injectable, signal } from '@angular/core';

import type { PersonalMovementWithId } from '../movements/movements';

export type MovementFormRequest = { mode: 'create' } | { mode: 'edit'; movement: PersonalMovementWithId };

/**
 * Estado compartido del modal de "agregar/editar movimiento": lo puede abrir
 * el FAB (siempre en modo create) desde el Shell, o el botón "editar" de un
 * movimiento en la vista de Movimientos — ambos fuera del árbol del otro.
 */
@Injectable({
  providedIn: 'root',
})
export class MovementFormState {
  private readonly _request = signal<MovementFormRequest | null>(null);
  readonly request = this._request.asReadonly();

  openCreate(): void {
    this._request.set({ mode: 'create' });
  }

  openEdit(movement: PersonalMovementWithId): void {
    this._request.set({ mode: 'edit', movement });
  }

  close(): void {
    this._request.set(null);
  }
}
