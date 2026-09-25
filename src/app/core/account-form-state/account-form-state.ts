import { Injectable, signal } from '@angular/core';

import type { AccountWithId } from '../accounts/accounts';

export type AccountFormRequest = { mode: 'create' } | { mode: 'edit'; account: AccountWithId };

/**
 * Estado compartido del modal de "agregar/editar cuenta". Se abre desde la
 * vista de Movimientos, pero el modal se renderiza a nivel de Shell — un
 * `position: fixed` dentro de un `<swiper-slide>` no cubre la pantalla
 * completa porque Swiper aplica `transform` a los slides, lo que redefine
 * el contenedor de los elementos fixed dentro de ellos.
 */
@Injectable({
  providedIn: 'root',
})
export class AccountFormState {
  private readonly _request = signal<AccountFormRequest | null>(null);
  readonly request = this._request.asReadonly();

  openCreate(): void {
    this._request.set({ mode: 'create' });
  }

  openEdit(account: AccountWithId): void {
    this._request.set({ mode: 'edit', account });
  }

  close(): void {
    this._request.set(null);
  }
}
