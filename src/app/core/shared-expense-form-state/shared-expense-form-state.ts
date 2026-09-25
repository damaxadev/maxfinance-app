import { Injectable, signal } from '@angular/core';

export interface SharedExpenseFormRequest {
  // Grupo fijado desde donde se disparó la acción (GroupDetail, tarjeta de
  // la lista de Grupos) — null cuando viene del FAB, que sigue usando el
  // grupo activo (ActiveGroup) sin cambios.
  groupId: string | null;
}

/**
 * Estado compartido del modal de "gasto compartido" — se renderiza a nivel
 * de Shell (mismo motivo que GroupFormState/AccountFormState: Swiper
 * aplica transform a los slides, lo que rompe position: fixed adentro).
 * Solo hay modo "crear" — no hay edición de gastos compartidos por ahora.
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

  openCreate(groupId?: string): void {
    this._request.set({ groupId: groupId ?? null });
    this._isPersonalFlow.set(false);
  }

  setPersonalFlow(value: boolean): void {
    this._isPersonalFlow.set(value);
  }

  close(): void {
    this._request.set(null);
  }
}
