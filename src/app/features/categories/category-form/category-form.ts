import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { Categories, type CategoryWithId } from '../../../core/categories/categories';
import type { CategoryType } from '../../../models/category.model';

const CATEGORY_TYPES: { value: CategoryType; label: string }[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
];

@Component({
  selector: 'mfx-category-form',
  imports: [ReactiveFormsModule],
  templateUrl: './category-form.html',
  styleUrl: './category-form.scss',
})
export class CategoryForm {
  private readonly categories = inject(Categories);
  private readonly fb = inject(FormBuilder);

  readonly initialValue = input<CategoryWithId | null>(null);
  readonly saved = output<void>();
  readonly deleted = output<void>();

  readonly categoryTypes = CATEGORY_TYPES;
  readonly saving = signal(false);
  readonly deleting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    icon: ['🏷️', Validators.required],
    type: ['expense' as CategoryType, Validators.required],
  });

  constructor() {
    effect(() => {
      const existing = this.initialValue();
      if (existing) {
        this.form.patchValue({ name: existing.name, icon: existing.icon, type: existing.type });
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
        await this.categories.update(existing.id, value);
      } else {
        await this.categories.create(value);
      }
      this.saved.emit();
    } catch (error) {
      console.error('Error al guardar la categoría', error);
      this.errorMessage.set('No pudimos guardar la categoría. Intenta de nuevo.');
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
      await this.categories.remove(existing.id);
      this.deleted.emit();
    } catch (error) {
      console.error('Error al eliminar la categoría', error);
      this.errorMessage.set('No pudimos eliminar la categoría.');
    } finally {
      this.deleting.set(false);
    }
  }
}
