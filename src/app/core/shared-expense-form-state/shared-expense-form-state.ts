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

  openCreate(groupId?: string): void {
    this._request.set({ groupId: groupId ?? null });
  }

  close(): void {
    this._request.set(null);
  }
}
