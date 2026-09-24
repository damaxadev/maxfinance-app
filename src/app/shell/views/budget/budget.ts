import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { switchMap } from 'rxjs';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { ProgressRing } from '../../../shared/progress-ring/progress-ring';
import { Auth } from '../../../core/auth/auth';
import {
  calculateBudgetProgress,
  calculateBudgetSummary,
  sumExpensesByCategory,
  type CategoryBudgetProgress,
} from '../../../core/budget-progress/budget-progress';
import { Budgets } from '../../../core/budgets/budgets';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { RecurringPaymentFormState } from '../../../core/recurring-payment-form-state/recurring-payment-form-state';
import { RecurringPayments, type PersonalRecurringPaymentWithId } from '../../../core/recurring-payments/recurring-payments';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toMonthKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

const UNBUDGETED: CategoryBudgetProgress = { categoryId: '', limit: 0, spent: 0, percentage: 0 };

@Component({
  selector: 'mfx-budget',
  imports: [Card, AnimatedNumber, ProgressRing, ReactiveFormsModule],
  templateUrl: './budget.html',
  styleUrl: './budget.scss',
})
export class Budget {
  private readonly budgetsService = inject(Budgets);
  private readonly movementsService = inject(MovementsService);
  private readonly groupsService = inject(GroupsService);
  private readonly categoriesService = inject(Categories);
  private readonly recurringPaymentsService = inject(RecurringPayments);
  private readonly auth = inject(Auth);
  private readonly fb = inject(FormBuilder);
  readonly recurringPaymentFormState = inject(RecurringPaymentFormState);

  private readonly today = new Date();
  private readonly month = toMonthKey(this.today);

  readonly monthLabel = capitalize(
    new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(this.today)
  );

  private readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);

  private readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  readonly expenseCategories = computed(() => this.categories().filter((c) => c.type === 'expense'));
  private readonly categoriesById = computed(() => new Map(this.categories().map((c) => [c.id, c])));

  private readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  private readonly groupIds = computed(() => this.groups().map((g) => g.id));

  private readonly movements = toSignal(
    toObservable(this.groupIds).pipe(switchMap((groupIds) => this.movementsService.combinedMovements$(groupIds))),
    { initialValue: [] }
  );
  private readonly budgets = toSignal(this.budgetsService.budgetsForMonth$(this.month), { initialValue: [] });

  readonly progress = computed(() => {
    const spentByCategory = sumExpensesByCategory(this.movements(), this.month, this.currentUid() ?? '');
    return calculateBudgetProgress(this.budgets(), spentByCategory);
  });
  private readonly progressByCategory = computed(() => new Map(this.progress().map((p) => [p.categoryId, p])));
  readonly summary = computed(() => calculateBudgetSummary(this.progress()));
  readonly summaryRingPercentage = computed(() => Math.min(100, this.summary().percentage));
  readonly summaryRingColor = computed(() => this.colorForPercentage(this.summary().percentage));

  readonly overBudgetCategories = computed(() => this.progress().filter((p) => p.percentage > 100));
  readonly overBudgetNames = computed(() =>
    this.overBudgetCategories()
      .map((p) => this.categoriesById().get(p.categoryId)?.name ?? 'una categoría')
      .join(', ')
  );

  readonly limitsForm = this.fb.record<FormControl<number>>({});
  readonly savingLimits = signal(false);
  readonly limitsError = signal<string | null>(null);

  readonly recurringPayments = toSignal(this.recurringPaymentsService.personalRecurringPayments$, { initialValue: [] });

  constructor() {
    // Reconstruye el form completo cada vez que cambian las categorías de
    // gasto o el presupuesto cargado — no se preserva lo tecleado a mitad
    // de edición (mismo criterio ya usado en shared-expense-form.ts): se
    // mantiene simple y predecible en vez de andar mezclando ediciones en
    // curso con datos remotos nuevos.
    effect(() => {
      const categories = this.expenseCategories();
      const limitByCategory = new Map(this.budgets().map((b) => [b.categoryId, b.limit]));
      for (const key of Object.keys(this.limitsForm.controls)) {
        this.limitsForm.removeControl(key);
      }
      for (const category of categories) {
        this.limitsForm.addControl(
          category.id,
          this.fb.nonNullable.control(limitByCategory.get(category.id) ?? 0, Validators.min(0))
        );
      }
    });
  }

  progressFor(categoryId: string): CategoryBudgetProgress {
    return this.progressByCategory().get(categoryId) ?? { ...UNBUDGETED, categoryId };
  }

  ringPercentage(categoryId: string): number {
    return Math.min(100, this.progressFor(categoryId).percentage);
  }

  ringColor(categoryId: string): string {
    return this.colorForPercentage(this.progressFor(categoryId).percentage);
  }

  private colorForPercentage(percentage: number): string {
    if (percentage > 100) return 'var(--danger)';
    if (percentage >= 80) return 'var(--accent)';
    return 'var(--primary)';
  }

  async saveLimits(): Promise<void> {
    if (this.limitsForm.invalid) {
      this.limitsForm.markAllAsTouched();
      return;
    }

    this.savingLimits.set(true);
    this.limitsError.set(null);

    try {
      await Promise.all(
        Object.entries(this.limitsForm.controls).map(([categoryId, control]) =>
          this.budgetsService.setLimit({ categoryId, month: this.month, limit: control.getRawValue() })
        )
      );
    } catch (error) {
      console.error('Error al guardar el presupuesto', error);
      this.limitsError.set('No pudimos guardar el presupuesto. Intenta de nuevo.');
    } finally {
      this.savingLimits.set(false);
    }
  }

  openCreateRecurring(): void {
    this.recurringPaymentFormState.openCreate();
  }

  openEditRecurring(payment: PersonalRecurringPaymentWithId): void {
    this.recurringPaymentFormState.openEdit(payment);
  }
}
