import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { Card } from '../../../shared/card/card';
import { Categories, type CategoryWithId } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';

@Component({
  selector: 'mfx-settings',
  imports: [Card, RouterLink],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly categoriesService = inject(Categories);
  private readonly categoryFormState = inject(CategoryFormState);

  private readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  readonly customCategories = computed(() => this.categories().filter((c) => c.uid !== null));

  openCreateCategory(): void {
    this.categoryFormState.openCreate();
  }

  openEditCategory(category: CategoryWithId): void {
    this.categoryFormState.openEdit(category);
  }
}
