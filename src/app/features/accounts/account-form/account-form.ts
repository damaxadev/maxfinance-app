import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Accounts, type AccountWithId } from '../../../core/accounts/accounts';
import type { AccountType } from '../../../models/account.model';

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'banco', label: 'Banco' },
  { value: 'tarjeta', label: 'Tarjeta' },
];

@Component({
  selector: 'mfx-account-form',
  imports: [ReactiveFormsModule],
  templateUrl: './account-form.html',
  styleUrl: './account-form.scss',
})
export class AccountForm {
  private readonly accounts = inject(Accounts);
  private readonly fb = inject(FormBuilder);

  readonly initialValue = input<AccountWithId | null>(null);
  readonly saved = output<void>();
  readonly deleted = output<void>();

  readonly accountTypes = ACCOUNT_TYPES;
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    type: ['efectivo' as AccountType, Validators.required],
  });

  constructor() {
    // input() puede resolverse después del constructor (p. ej. vía
    // fixture.componentRef.setInput en tests), así que el formulario se
    // rellena reactivamente en vez de una sola vez al inicializar el campo.
    effect(() => {
      const existing = this.initialValue();
      if (existing) {
        this.form.patchValue({ name: existing.name, type: existing.type });
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
    const value = this.form.getRawValue();

    try {
      const existing = this.initialValue();
      if (existing) {
        await this.accounts.update(existing.id, value);
      } else {
        await this.accounts.create(value);
      }
      this.saved.emit();
    } catch (error) {
      console.error('Error al guardar la cuenta', error);
      this.errorMessage.set('No pudimos guardar la cuenta. Intenta de nuevo.');
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
      await this.accounts.remove(existing.id);
      this.deleted.emit();
    } catch (error) {
      console.error('Error al eliminar la cuenta', error);
      this.errorMessage.set(error instanceof Error ? error.message : 'No pudimos eliminar la cuenta.');
    } finally {
      this.deleting.set(false);
    }
  }
}
