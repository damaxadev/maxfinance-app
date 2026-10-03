import { Injectable, signal } from '@angular/core';

import type { SharedMovementWithId } from '../movements/movements';

export type SharedExpenseFormRequest =
  | { mode: 'create'; groupId: string | null }
  | { mode: 'edit'; movement: SharedMovementWithId };

/**
 * Estado compartido del modal de "gasto compartido" — se renderiza a nivel
 * de Shell (mismo motivo que GroupFormState/AccountFormState: Swiper
 * aplica transform a los slides, lo que rompe position: fixed adentro).
 */
@Injectable({
  providedIn: 'root',
})
export class SharedExpenseFormState {
  private readonly _request = signal<SharedExpenseFormRequest | null>(null);
  readonly request = this._request.asReadonly();

  // SharedExpenseForm lo actualiza una vez que sabe cuántos miembros tiene
  // el grupo (fetch async, ver getMemberProfiles) — Shell lo lee para el
  // título del modal, ya que Shell mismo no tiene esa info de antemano
  // (mismo patrón que CategoryFormState.lastSaved).
  private readonly _isPersonalFlow = signal(false);
  readonly isPersonalFlow = this._isPersonalFlow.asReadonly();

  // SharedExpenseForm lo actualiza una vez que sabe si quien mira es quien
  // creó el gasto y si no está bloqueado por un settlement posterior (ver
  // DATABASE.md / Fase 10, "Solo lectura para quien no lo creó o está
  // bloqueado") — Shell lo lee para no titular "Editar" un modal que en
  // realidad no deja editar nada.
  private readonly _readOnly = signal(false);
  readonly readOnly = this._readOnly.asReadonly();

  openCreate(groupId?: string): void {
    this._request.set({ mode: 'create', groupId: groupId ?? null });
    this._isPersonalFlow.set(false);
    this._readOnly.set(false);
  }

  openEdit(movement: SharedMovementWithId): void {
    this._request.set({ mode: 'edit', movement });
    this._isPersonalFlow.set(false);
    this._readOnly.set(false);
  }

  setPersonalFlow(value: boolean): void {
    this._isPersonalFlow.set(value);
  }

  setReadOnly(value: boolean): void {
    this._readOnly.set(value);
  }

  close(): void {
    this._request.set(null);
  }
}
