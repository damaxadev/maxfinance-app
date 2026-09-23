import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

import { Accounts } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';
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

// Valor sentinel para la opción "+ Nueva categoría" del <select>: nunca es
// un id de categoría real, así que nunca debe quedar como valor final del
// control (se revierte apenas se detecta, ver el effect correspondiente).
const NEW_CATEGORY_OPTION = '__new_category__';

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
  private readonly categoryFormState = inject(CategoryFormState);
  private readonly fb = inject(FormBuilder);

  readonly initialValue = input<PersonalMovementWithId | null>(null);
  readonly saved = output<void>();
  readonly deleted = output<void>();

  readonly movementTypes = MOVEMENT_TYPES;
  readonly newCategoryOption = NEW_CATEGORY_OPTION;
  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });

  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly categoryError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    type: ['expense' as MovementType, Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    accountId: ['', Validators.required],
    categoryId: ['', Validators.required],
    date: [toDateInputValue(new Date()), Validators.required],
    note: [''],
  });

  readonly typeValue = toSignal(this.form.controls.type.valueChanges, {
    initialValue: this.form.controls.type.value,
  });

  private readonly categoryIdValue = toSignal(this.form.controls.categoryId.valueChanges, {
    initialValue: this.form.controls.categoryId.value,
  });

  readonly filteredCategories = computed(() => this.categories().filter((c) => c.type === this.typeValue()));

  constructor() {
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

    // El <select> de categoría usa un valor sentinel para "+ Nueva
    // categoría" en vez de un botón aparte. Al elegirlo, abrimos el modal
    // de categoría (vive a nivel de Shell desde Fase 3, ya resuelto el
    // problema de position:fixed dentro de Swiper) y revertimos el valor
    // sentinel sin emitir el cambio, para que nunca cuente como selección
    // real ni dispare la validación del campo.
    effect(() => {
      if (this.categoryIdValue() === NEW_CATEGORY_OPTION) {
        this.categoryFormState.openCreate();
        this.form.controls.categoryId.setValue('', { emitEvent: false });
      }
    });

    // Sincronizamos también el tipo del movimiento con el de la categoría
    // nueva: si no coincidieran, filteredCategories() (filtrada por tipo)
    // no la incluiría y submit() la rechazaría con el error de categoría
    // inválida en vez de dejarla auto-seleccionada de verdad.
    effect(() => {
      const saved = this.categoryFormState.lastSaved();
      if (saved) {
        this.form.patchValue({ type: saved.type, categoryId: saved.id });
        this.categoryFormState.clearLastSaved();
      }
    });
  }

  selectType(type: MovementType): void {
    if (this.form.controls.type.value === type) {
      return;
    }
    this.form.controls.type.setValue(type);
    void this.buzz();
  }

  async submit(): Promise<void> {
    // La categoría se valida acá, no reactivamente: categories() carga de
    // forma async y arranca vacío en cada instancia nueva del componente,
    // así que un effect que reaccionara a filteredCategories() cambiando
    // podría ver una lista todavía vacía y borrar un categoryId que en
    // realidad sí era válido (la carrera que rompía "editar movimiento").
    // Si categories() sigue vacío, todavía no hay datos para juzgar — se
    // deja pasar y que Validators.required actúe si el campo está vacío.
    const categoryId = this.form.controls.categoryId.value;
    const categoriesLoaded = this.categories().length > 0;
    if (categoryId && categoriesLoaded && !this.filteredCategories().some((c) => c.id === categoryId)) {
      this.categoryError.set('La categoría seleccionada no es válida para este tipo, elige otra.');
      return;
    }
    this.categoryError.set(null);

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

  private async buzz(): Promise<void> {
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Sin soporte háptico (navegador de escritorio) — no bloquea la UI.
    }
  }
}
