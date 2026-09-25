import { Injectable, signal } from '@angular/core';

/**
 * Estado compartido del modal de "crear grupo" — se renderiza a nivel de
 * Shell, no dentro del <swiper-slide> de Grupos (mismo motivo que
 * AccountFormState/CategoryFormState: Swiper aplica transform a los
 * slides, lo que rompe position: fixed en modales renderizados dentro).
 * Solo hay modo "crear" — no existe edición de nombre de grupo por ahora.
 */
@Injectable({
  providedIn: 'root',
})
export class GroupFormState {
  private readonly _open = signal(false);
  readonly open = this._open.asReadonly();

  openCreate(): void {
    this._open.set(true);
  }

  close(): void {
    this._open.set(false);
  }
}
