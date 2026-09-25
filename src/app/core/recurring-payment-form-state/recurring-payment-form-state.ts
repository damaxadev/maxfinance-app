import { Injectable, signal } from '@angular/core';

import type { PersonalRecurringPaymentWithId } from '../recurring-payments/recurring-payments';

export type RecurringPaymentFormRequest =
  | { mode: 'create' }
  | { mode: 'edit'; payment: PersonalRecurringPaymentWithId };

/**
 * Estado compartido del modal de "pago recurrente" — se renderiza a nivel
 * de Shell (mismo motivo que MovementFormState: Swiper aplica transform a
 * los slides, lo que rompe position: fixed adentro).
 */
@Injectable({
  providedIn: 'root',
})
export class RecurringPaymentFormState {
  private readonly _request = signal<RecurringPaymentFormRequest | null>(null);
  readonly request = this._request.asReadonly();

  openCreate(): void {
    this._request.set({ mode: 'create' });
  }

  openEdit(payment: PersonalRecurringPaymentWithId): void {
    this._request.set({ mode: 'edit', payment });
  }

  close(): void {
    this._request.set(null);
  }
}
