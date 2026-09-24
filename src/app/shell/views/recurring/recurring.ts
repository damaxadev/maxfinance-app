import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Checkbox } from '../../../shared/checkbox/checkbox';
import { Notifications } from '../../../core/notifications/notifications';
import { RecurringPaymentFormState } from '../../../core/recurring-payment-form-state/recurring-payment-form-state';
import { RecurringPayments, type PersonalRecurringPaymentWithId } from '../../../core/recurring-payments/recurring-payments';

@Component({
  selector: 'mfx-recurring',
  imports: [Card, AnimatedNumber, Checkbox, ReactiveFormsModule],
  templateUrl: './recurring.html',
  styleUrl: './recurring.scss',
})
export class Recurring {
  private readonly recurringPaymentsService = inject(RecurringPayments);
  private readonly notificationsService = inject(Notifications);
  readonly recurringPaymentFormState = inject(RecurringPaymentFormState);

  readonly recurringPayments = toSignal(this.recurringPaymentsService.personalRecurringPayments$, { initialValue: [] });

  // Movido desde Ajustes (Fase 7, ver DESIGN.md) — un solo lugar, no
  // duplicado: acá es donde de verdad vive la única función que hoy usa
  // notificaciones (avisos de pagos recurrentes procesados).
  readonly notificationsControl = new FormControl(false, { nonNullable: true });
  readonly notificationsMessage = signal<string | null>(null);

  constructor() {
    this.notificationsService
      .checkStatus()
      .then((status) => {
        if (status === 'granted') {
          this.notificationsControl.setValue(true, { emitEvent: false });
          this.notificationsControl.disable({ emitEvent: false });
        }
      })
      .catch((error) => console.error('Error al consultar el estado de notificaciones', error));

    this.notificationsControl.valueChanges.subscribe((checked) => {
      if (checked) {
        void this.enableNotifications();
      }
    });
  }

  openCreateRecurring(): void {
    this.recurringPaymentFormState.openCreate();
  }

  openEditRecurring(payment: PersonalRecurringPaymentWithId): void {
    this.recurringPaymentFormState.openEdit(payment);
  }

  private async enableNotifications(): Promise<void> {
    this.notificationsMessage.set(null);
    try {
      const result = await this.notificationsService.enable();
      if (result === 'granted') {
        this.notificationsControl.disable({ emitEvent: false });
        return;
      }
      this.notificationsControl.setValue(false, { emitEvent: false });
      this.notificationsMessage.set(
        result === 'denied-permanently'
          ? 'Debes habilitar las notificaciones manualmente desde los ajustes del sistema.'
          : 'No concediste el permiso — puedes intentarlo de nuevo cuando quieras.'
      );
    } catch (error) {
      console.error('Error al activar notificaciones', error);
      this.notificationsControl.setValue(false, { emitEvent: false });
      this.notificationsMessage.set('No pudimos activar las notificaciones. Intenta de nuevo.');
    }
  }
}
