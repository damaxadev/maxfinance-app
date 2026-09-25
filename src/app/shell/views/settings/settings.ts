import { ChangeDetectorRef, Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { MfxCurrencyInputDirective } from '../../../shared/currency/currency-input.directive';
import { ProgressRing } from '../../../shared/progress-ring/progress-ring';
import { ThemeToggle } from '../../../shared/theme-toggle/theme-toggle';
import { AiSummary, type AiUsageInfo } from '../../../core/ai-summary/ai-summary';
import { Auth } from '../../../core/auth/auth';
import {
  calculateBudgetProgress,
  sumExpensesByCategory,
  type CategoryBudgetProgress,
} from '../../../core/budget-progress/budget-progress';
import { Budgets } from '../../../core/budgets/budgets';
import { Categories, type CategoryWithId } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';

function toMonthKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

@Component({
  selector: 'mfx-settings',
  imports: [Card, RouterLink, AnimatedNumber, ProgressRing, ReactiveFormsModule, MfxCurrencyInputDirective, ThemeToggle],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  private readonly categoriesService = inject(Categories);
  private readonly categoryFormState = inject(CategoryFormState);
  private readonly budgetsService = inject(Budgets);
  private readonly movementsService = inject(MovementsService);
  private readonly groupsService = inject(GroupsService);
  private readonly auth = inject(Auth);
  private readonly aiSummary = inject(AiSummary);
  private readonly fb = inject(FormBuilder);
  private readonly changeDetectorRef = inject(ChangeDetectorRef);

  private readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  readonly customCategories = computed(() => this.categories().filter((c) => c.uid !== null));
  readonly expenseCategories = computed(() => this.categories().filter((c) => c.type === 'expense'));
  private readonly categoriesById = computed(() => new Map(this.categories().map((c) => [c.id, c])));

  // --- Presupuestos (opt-in por categoría, ver DESIGN.md/BACKLOG 49b) ---
  private readonly month = toMonthKey(new Date());
  private readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);

  private readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  private readonly groupIds = computed(() => this.groups().map((g) => g.id));
  private readonly movements = toSignal(
    toObservable(this.groupIds).pipe(switchMap((groupIds) => this.movementsService.combinedMovements$(groupIds))),
    { initialValue: [] }
  );
  private readonly budgets = toSignal(this.budgetsService.budgetsForMonth$(this.month), { initialValue: [] });

  // Solo las categorías que YA tienen un budget este mes — opt-in, no las
  // 10 de una vez con límite en $0 (lo que hacía la versión anterior).
  readonly budgetedProgress = computed(() => {
    const spentByCategory = sumExpensesByCategory(this.movements(), this.month, this.currentUid() ?? '');
    return calculateBudgetProgress(this.budgets(), spentByCategory);
  });

  readonly unbudgetedExpenseCategories = computed(() => {
    const budgetedIds = new Set(this.budgets().map((b) => b.categoryId));
    return this.expenseCategories().filter((c) => !budgetedIds.has(c.id));
  });

  readonly addingBudget = signal(false);
  readonly addBudgetForm = this.fb.nonNullable.group({
    categoryId: ['', Validators.required],
    limit: [0, [Validators.required, Validators.min(1)]],
  });
  readonly savingBudget = signal(false);
  readonly budgetError = signal<string | null>(null);

  // Edición inline del límite de una categoría ya presupuestada — solo una
  // fila a la vez (mismo patrón ya usado en GroupActivity para "registrar
  // como gasto/ingreso": abrir un formulario inline por fila, no un modal).
  readonly editingCategoryId = signal<string | null>(null);
  readonly editLimitControl = this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]);

  // --- Uso de IA (control visible, ver DESIGN.md/BACKLOG 57) ---
  readonly aiUsage = signal<AiUsageInfo | null>(null);
  readonly aiUsageLoading = signal(true);
  readonly aiUsageError = signal<string | null>(null);

  readonly nextAnalysisLabel = computed(() => {
    const usage = this.aiUsage();
    if (!usage?.nextAvailableAt) {
      return 'Disponible ahora mismo.';
    }
    const formatted = new Intl.DateTimeFormat('es-CO', {
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(usage.nextAvailableAt));
    return `Disponible de nuevo el ${formatted}.`;
  });

  constructor() {
    // Si la categoría seleccionada para agregar deja de estar disponible
    // (por ejemplo, porque se agregó desde otra pestaña), no dejar un valor
    // stale seleccionado.
    effect(() => {
      const ids = new Set(this.unbudgetedExpenseCategories().map((c) => c.id));
      if (this.addBudgetForm.controls.categoryId.value && !ids.has(this.addBudgetForm.controls.categoryId.value)) {
        this.addBudgetForm.controls.categoryId.setValue('');
      }
    });

    void this.loadAiUsage();
  }

  private async loadAiUsage(): Promise<void> {
    this.aiUsageLoading.set(true);
    this.aiUsageError.set(null);
    try {
      this.aiUsage.set(await this.aiSummary.getUsage());
    } catch (error) {
      this.aiUsageError.set(error instanceof Error ? error.message : 'No pudimos consultar el uso de IA.');
    } finally {
      this.aiUsageLoading.set(false);
      // App zoneless (ver la auditoría de Fase 8, mismo motivo que en
      // Recurring): esta llamada resuelve fuera de cualquier evento
      // trackeado por Angular — sin este markForCheck(), la sección "Uso
      // de IA" se queda mostrando "Consultando…" hasta que algo más, ajeno
      // a este flujo, dispare un re-render por su cuenta.
      this.changeDetectorRef.markForCheck();
    }
  }

  categoryLabel(categoryId: string): string {
    const category = this.categoriesById().get(categoryId);
    return category ? `${category.icon} ${category.name}` : 'Categoría eliminada';
  }

  ringColor(progress: CategoryBudgetProgress): string {
    if (progress.percentage > 100) return 'var(--danger)';
    if (progress.percentage >= 80) return 'var(--accent)';
    return 'var(--primary)';
  }

  ringPercentage(progress: CategoryBudgetProgress): number {
    return Math.min(100, progress.percentage);
  }

  openAddBudget(): void {
    this.addingBudget.set(true);
    this.budgetError.set(null);
    this.addBudgetForm.reset({ categoryId: '', limit: 0 });
  }

  cancelAddBudget(): void {
    this.addingBudget.set(false);
  }

  async submitAddBudget(): Promise<void> {
    if (this.addBudgetForm.invalid) {
      this.addBudgetForm.markAllAsTouched();
      return;
    }

    this.savingBudget.set(true);
    this.budgetError.set(null);
    const raw = this.addBudgetForm.getRawValue();

    try {
      await this.budgetsService.setLimit({ categoryId: raw.categoryId, month: this.month, limit: raw.limit });
      this.addingBudget.set(false);
    } catch (error) {
      console.error('Error al agregar la categoría al presupuesto', error);
      this.budgetError.set('No pudimos agregar la categoría. Intenta de nuevo.');
    } finally {
      this.savingBudget.set(false);
    }
  }

  startEditLimit(progress: CategoryBudgetProgress): void {
    this.editingCategoryId.set(progress.categoryId);
    this.editLimitControl.setValue(progress.limit);
    this.budgetError.set(null);
  }

  cancelEditLimit(): void {
    this.editingCategoryId.set(null);
  }

  async saveEditLimit(categoryId: string): Promise<void> {
    if (this.editLimitControl.invalid) {
      this.editLimitControl.markAsTouched();
      return;
    }

    this.savingBudget.set(true);
    this.budgetError.set(null);

    try {
      await this.budgetsService.setLimit({ categoryId, month: this.month, limit: this.editLimitControl.getRawValue() });
      this.editingCategoryId.set(null);
    } catch (error) {
      console.error('Error al actualizar el límite', error);
      this.budgetError.set('No pudimos actualizar el límite. Intenta de nuevo.');
    } finally {
      this.savingBudget.set(false);
    }
  }

  async removeBudget(categoryId: string): Promise<void> {
    this.budgetError.set(null);
    try {
      await this.budgetsService.removeLimit(categoryId, this.month);
    } catch (error) {
      console.error('Error al quitar la categoría del presupuesto', error);
      this.budgetError.set('No pudimos quitar la categoría. Intenta de nuevo.');
    }
  }

  openCreateCategory(): void {
    this.categoryFormState.openCreate();
  }

  openEditCategory(category: CategoryWithId): void {
    this.categoryFormState.openEdit(category);
  }
}
