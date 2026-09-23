import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Accounts } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { MovementsService, type PersonalMovementWithId } from '../../../core/movements/movements';
import type { MovementType } from '../../../models/movement.model';

function toDateInputValue(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const MOVEMENT_TYPES: { value: MovementType; label: string }[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
];

@Component({
  selector: 'mfx-movement-form',
  imports: [ReactiveFormsModule],
  templateUrl: './movement-form.html',
  styleUrl: './movement-form.scss',
})
export class MovementForm {
  private readonly movements = inject(MovementsService);
  private readonly accountsService = inject(Accounts);
  private readonly categoriesService = inject(Categories);
  private readonly fb = inject(FormBuilder);

  readonly initialValue = input<PersonalMovementWithId | null>(null);
  readonly saved = output<void>();
  readonly deleted = output<void>();

  readonly movementTypes = MOVEMENT_TYPES;
  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });

  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    type: ['expense' as MovementType, Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    accountId: ['', Validators.required],
    categoryId: ['', Validators.required],
    date: [toDateInputValue(new Date()), Validators.required],
    note: [''],
  });

  private readonly typeValue = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });

  readonly filteredCategories = computed(() => this.categories().filter((c) => c.type === this.typeValue()));

  constructor() {
    // Si cambia el tipo y la categoría elegida ya no aplica, se limpia.
    effect(() => {
      const valid = this.filteredCategories();
      const current = this.form.controls.categoryId.value;
      if (current && !valid.some((c) => c.id === current)) {
        this.form.controls.categoryId.setValue('');
      }
    });

    effect(() => {
      const existing = this.initialValue();
      if (existing) {
        this.form.patchValue({
          type: existing.type,
          amount: existing.amount,
          accountId: existing.accountId,
          categoryId: existing.categoryId,
          date: toDateInputValue(existing.date.toDate()),
          note: existing.note,
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
    const raw = this.form.getRawValue();
    const value = { ...raw, date: new Date(`${raw.date}T00:00:00`) };

    try {
      const existing = this.initialValue();
      if (existing) {
        await this.movements.update(existing.id, existing, value);
      } else {
        await this.movements.create(value);
      }
      this.saved.emit();
    } catch (error) {
      console.error('Error al guardar el movimiento', error);
      this.errorMessage.set('No pudimos guardar el movimiento. Intenta de nuevo.');
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
      await this.movements.remove(existing.id, existing);
      this.deleted.emit();
    } catch (error) {
      console.error('Error al eliminar el movimiento', error);
      this.errorMessage.set('No pudimos eliminar el movimiento.');
    } finally {
      this.deleting.set(false);
    }
  }
}
