import { Injectable, signal } from '@angular/core';

import type { PersonalMovementWithId } from '../movements/movements';

export type MovementFormRequest =
  | { mode: 'create'; groupId: string | null }
  | { mode: 'edit'; movement: PersonalMovementWithId };

/**
 * Estado compartido del modal de "agregar/editar movimiento": lo puede abrir
 * el FAB (siempre en modo create, sin grupo) desde el Shell, el botón
 * "editar" de un movimiento en la vista de Movimientos, o "+ Agregar gasto"
 * en un grupo type: 'personal' (GroupDetail/Grupos — ver DATABASE.md,
 * "Gasto en grupo personal": usa este mismo formulario simple, no
 * SharedExpenseForm) — todos fuera del árbol del otro.
 */
@Injectable({
  providedIn: 'root',
})
export class MovementFormState {
  private readonly _request = signal<MovementFormRequest | null>(null);
  readonly request = this._request.asReadonly();

  openCreate(groupId: string | null = null): void {
    this._request.set({ mode: 'create', groupId });
  }

  openEdit(movement: PersonalMovementWithId): void {
    this._request.set({ mode: 'edit', movement });
  }

  close(): void {
    this._request.set(null);
  }
}
