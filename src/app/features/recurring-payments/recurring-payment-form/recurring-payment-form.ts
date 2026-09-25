import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Accounts } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { Notifications } from '../../../core/notifications/notifications';
import {
  RecurringPayments,
  type PersonalRecurringPaymentWithId,
  type RecurringPaymentFormValue,
} from '../../../core/recurring-payments/recurring-payments';
import { Checkbox } from '../../../shared/checkbox/checkbox';
import { MfxCurrencyInputDirective } from '../../../shared/currency/currency-input.directive';

function toDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

type Frequency = RecurringPaymentFormValue['frequency'];

// Orden de más a menos frecuente — ver DATABASE.md/BACKLOG 63.
const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Diaria' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'biweekly', label: 'Quincenal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'bimonthly', label: 'Bimestral' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'semiannual', label: 'Semestral' },
  { value: 'annual', label: 'Anual' },
];

@Component({
  selector: 'mfx-recurring-payment-form',
  imports: [ReactiveFormsModule, Checkbox, MfxCurrencyInputDirective],
  templateUrl: './recurring-payment-form.html',
  styleUrl: './recurring-payment-form.scss',
})
export class RecurringPaymentForm {
  private readonly recurringPayments = inject(RecurringPayments);
  private readonly accountsService = inject(Accounts);
  private readonly categoriesService = inject(Categories);
  private readonly notifications = inject(Notifications);
  private readonly fb = inject(FormBuilder);

  readonly initialValue = input<PersonalRecurringPaymentWithId | null>(null);
  readonly saved = output<void>();
  readonly deleted = output<void>();

  readonly frequencies = FREQUENCIES;
  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  readonly expenseCategories = computed(() => this.categories().filter((c) => c.type === 'expense'));

  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  // Feedback no bloqueante sobre el permiso de notificaciones — nunca
  // impide guardar el recurrente, solo informa qué pasó con el permiso.
  readonly notificationsMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    categoryId: ['', Validators.required],
    accountId: ['', Validators.required],
    frequency: ['monthly' as Frequency, Validators.required],
    nextDate: [toDateInputValue(new Date()), Validators.required],
    active: [false],
  });

  constructor() {
    effect(() => {
      const existing = this.initialValue();
      if (existing) {
        this.form.patchValue({
          name: existing.name,
          amount: existing.amount,
          categoryId: existing.categoryId,
          accountId: existing.accountId,
          frequency: existing.frequency as Frequency,
          nextDate: toDateInputValue(existing.nextDate.toDate()),
          active: existing.active,
        });
      }
    });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    this.notificationsMessage.set(null);
    const raw = this.form.getRawValue();
    const existing = this.initialValue();
    // Se pide el permiso de notificaciones solo en la transición real de
    // "inactivo/nuevo" -> activo, nunca al abrir la app ni al reeditar un
    // recurrente que ya estaba activo.
    const activatingNow = raw.active && !(existing?.active ?? false);

    const value: RecurringPaymentFormValue = {
      name: raw.name,
      amount: raw.amount,
      categoryId: raw.categoryId,
      accountId: raw.accountId,
      frequency: raw.frequency,
      nextDate: new Date(`${raw.nextDate}T00:00:00`),
      active: raw.active,
    };

    try {
      if (existing) {
        await this.recurringPayments.update(existing.id, value);
      } else {
        await this.recurringPayments.create(value);
      }

      if (activatingNow && !(await this.tryEnableNotifications())) {
        // Se guardó bien, pero hay un mensaje no bloqueante que mostrar —
        // se deja el modal abierto para que el usuario lo lea y lo cierre
        // él mismo (no se emite saved todavía).
        return;
      }

      this.saved.emit();
    } catch (error) {
      console.error('Error al guardar el pago recurrente', error);
      this.errorMessage.set('No pudimos guardar el pago recurrente. Intenta de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    const existing = this.initialValue();
    if (!existing) {
      return;
    }

    this.deleting.set(true);
    this.errorMessage.set(null);

    try {
      await this.recurringPayments.remove(existing.id);
      this.deleted.emit();
    } catch (error) {
      console.error('Error al eliminar el pago recurrente', error);
      this.errorMessage.set('No pudimos eliminar el pago recurrente.');
    } finally {
      this.deleting.set(false);
    }
  }

  // Devuelve true si quedó "granted" (o no había nada que pedir). Si no,
  // deja el mensaje correspondiente en notificationsMessage() y devuelve
  // false para que submit() sepa que debe quedarse abierto mostrándolo.
  private async tryEnableNotifications(): Promise<boolean> {
    try {
      const result = await this.notifications.enable();
      if (result === 'granted') {
        return true;
      }
      this.notificationsMessage.set(
        result === 'denied-permanently'
          ? 'Guardado. Para recibir notificaciones de este pago, habilítalas manualmente desde los ajustes del sistema.'
          : 'Guardado. No vas a recibir notificaciones de este pago (permiso denegado) — puedes intentarlo de nuevo más tarde.'
      );
      return false;
    } catch (error) {
      console.error('Error al activar notificaciones', error);
      // Falla inesperada (no una negación normal) — no atrapamos al
      // usuario en el modal por esto, el guardado ya fue exitoso.
      return true;
    }
  }
}
