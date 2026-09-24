import { Injectable, signal } from '@angular/core';

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
  private readonly _open = signal(false);
  readonly open = this._open.asReadonly();

  openCreate(): void {
    this._open.set(true);
  }

  close(): void {
    this._open.set(false);
  }
}
