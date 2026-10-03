import { Injectable, signal } from '@angular/core';

/**
 * Estado compartido del modal de "crear meta de ahorro" — se renderiza a
 * nivel de Shell, mismo motivo que GroupFormState (Swiper aplica transform
 * a los slides, lo que rompe position: fixed en modales renderizados
 * dentro). Solo hay modo "crear" — no existe edición de una meta por ahora.
 */
@Injectable({
  providedIn: 'root',
})
export class GoalFormState {
  private readonly _open = signal(false);
  readonly open = this._open.asReadonly();

  openCreate(): void {
    this._open.set(true);
  }

  close(): void {
    this._open.set(false);
  }
}
