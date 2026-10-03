import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Celebration } from '../../../core/celebration/celebration';
import { MovementsService } from '../../../core/movements/movements';
import type { SettlementContext } from '../../../core/settlement-form-state/settlement-form-state';
import { SettlementsService } from '../../../core/settlements/settlements';
import { Checkbox } from '../../../shared/checkbox/checkbox';
import { MfxCurrencyInputDirective } from '../../../shared/currency/currency-input.directive';

@Component({
  selector: 'mfx-settlement-form',
  imports: [ReactiveFormsModule, Checkbox, MfxCurrencyInputDirective],
  templateUrl: './settlement-form.html',
  styleUrl: './settlement-form.scss',
})
export class SettlementForm {
  private readonly settlementsService = inject(SettlementsService);
  private readonly movementsService = inject(MovementsService);
  private readonly accountsService = inject(Accounts);
  private readonly auth = inject(Auth);
  private readonly celebration = inject(Celebration);
  private readonly fb = inject(FormBuilder);

  readonly context = input.required<SettlementContext>();
  readonly saved = output<void>();

  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);
  readonly isPayer = computed(() => this.context().fromUid === this.currentUid());
  // Pagar una cuota específica: el monto ya está fijo (ver DATABASE.md,
  // "Pagos a cuotas") y no se ofrece "registrar también como movimiento
  // personal" — no se pidió para cuotas, y evita duplicar esa lógica en la
  // Cloud Function que esto termina llamando (ver submit()).
  readonly isInstallmentPayment = computed(() => !!this.context().installmentRef);

  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(0.01)]],
    note: [''],
    registerPersonalMovement: [false],
    accountId: [''],
  });

  private readonly registerPersonalMovementValue = toSignal(
    this.form.controls.registerPersonalMovement.valueChanges,
    { initialValue: this.form.controls.registerPersonalMovement.value }
  );

  constructor() {
    // El monto viene prellenado con lo que realmente se debe. Sigue siendo
    // editable (p. ej. para registrar un pago parcial) salvo al pagar una
    // cuota específica — ahí queda bloqueado al monto exacto de esa cuota,
    // para que su estado "pagada" siempre corresponda 1:1 con lo que se
    // registró (ver isInstallmentPayment()).
    effect(() => {
      this.form.controls.amount.setValue(this.context().amount, { emitEvent: false });
      if (this.isInstallmentPayment()) {
        this.form.controls.amount.disable({ emitEvent: false });
      } else {
        this.form.controls.amount.enable({ emitEvent: false });
      }
    });

    // accountId solo es obligatorio si se marca el checkbox — se agrega o
    // se quita el validador dinámicamente en vez de dejarlo siempre puesto.
    effect(() => {
      if (this.registerPersonalMovementValue()) {
        this.form.controls.accountId.addValidators(Validators.required);
      } else {
        this.form.controls.accountId.clearValidators();
        this.form.controls.accountId.setValue('', { emitEvent: false });
      }
      this.form.controls.accountId.updateValueAndValidity();
    });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    const raw = this.form.getRawValue();
    const context = this.context();

    try {
      if (context.installmentRef) {
        await this.movementsService.payInstallment(
          context.installmentRef.movementId,
          context.installmentRef.installmentIndex,
          raw.note
        );
      } else {
        await this.settlementsService.create({
          groupId: context.groupId,
          fromUid: context.fromUid,
          toUid: context.toUid,
          amount: raw.amount,
          note: raw.note,
          personalMovementAccountId: raw.registerPersonalMovement ? raw.accountId : null,
        });
      }
      await this.celebration.celebrate();
      this.saved.emit();
    } catch (error) {
      console.error('Error al registrar el pago', error);
      this.errorMessage.set('No pudimos registrar el pago. Intenta de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }
}
