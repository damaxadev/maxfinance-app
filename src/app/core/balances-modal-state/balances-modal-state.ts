import { Injectable, signal } from '@angular/core';

/**
 * Estado compartido del modal "Balances" (desglose por cuenta + "Analizar
 * balances") — se renderiza a nivel de Shell, mismo motivo que
 * GroupDetailState/GroupFormState.
 */
@Injectable({
  providedIn: 'root',
})
export class BalancesModalState {
  private readonly _open = signal(false);
  readonly open = this._open.asReadonly();

  show(): void {
    this._open.set(true);
  }

  close(): void {
    this._open.set(false);
  }
}
