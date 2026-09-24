import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { Accounts } from '../../../core/accounts/accounts';
import { AiSummary, type SummaryResult } from '../../../core/ai-summary/ai-summary';
import { Auth } from '../../../core/auth/auth';
import { calculateBudgetProgress, calculateBudgetSummary, sumExpensesByCategory } from '../../../core/budget-progress/budget-progress';
import { Budgets } from '../../../core/budgets/budgets';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';

function toMonthKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

@Component({
  selector: 'mfx-balances-modal',
  imports: [Card, AnimatedNumber],
  templateUrl: './balances-modal.html',
  styleUrl: './balances-modal.scss',
})
export class BalancesModal {
  private readonly accountsService = inject(Accounts);
  private readonly budgetsService = inject(Budgets);
  private readonly movementsService = inject(MovementsService);
  private readonly groupsService = inject(GroupsService);
  private readonly categoriesService = inject(Categories);
  private readonly auth = inject(Auth);
  private readonly aiSummary = inject(AiSummary);

  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly totalBalance = computed(() => this.accounts().reduce((sum, account) => sum + account.balance, 0));

  private readonly month = toMonthKey(new Date());
  private readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);

  private readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  private readonly categoriesById = computed(() => new Map(this.categories().map((category) => [category.id, category])));

  private readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  private readonly groupIds = computed(() => this.groups().map((group) => group.id));
  private readonly movements = toSignal(
    toObservable(this.groupIds).pipe(switchMap((groupIds) => this.movementsService.combinedMovements$(groupIds))),
    { initialValue: [] }
  );
  private readonly budgets = toSignal(this.budgetsService.budgetsForMonth$(this.month), { initialValue: [] });

  private readonly spentByCategory = computed(() =>
    sumExpensesByCategory(this.movements(), this.month, this.currentUid() ?? '')
  );
  private readonly budgetSummary = computed(() =>
    calculateBudgetSummary(calculateBudgetProgress(this.budgets(), this.spentByCategory()))
  );
  private readonly hasBudget = computed(() => this.budgets().length > 0);

  readonly analyzing = signal(false);
  readonly analysisError = signal<string | null>(null);
  readonly analysisResult = signal<SummaryResult | null>(null);

  // Texto ya formateado (no un número) para no repetir la lógica de
  // singular/plural — y para que un resultado cacheado de hace 0h todavía
  // se muestre (un `@if` sobre un número 0 se evaluaría como falsy).
  readonly cachedAgeLabel = computed<string | null>(() => {
    const result = this.analysisResult();
    if (!result?.cached) {
      return null;
    }
    const hours = Math.max(0, Math.round((Date.now() - new Date(result.generatedAt).getTime()) / (60 * 60 * 1000)));
    if (hours === 0) {
      return 'menos de una hora';
    }
    return hours === 1 ? '1 hora' : `${hours} horas`;
  });

  async analyzeBalances(): Promise<void> {
    this.analyzing.set(true);
    this.analysisError.set(null);
    try {
      const categoryTotals = [...this.spentByCategory().entries()].map(([categoryId, total]) => ({
        category: this.categoriesById().get(categoryId)?.name ?? 'Categoría eliminada',
        total,
      }));
      const summary = this.budgetSummary();

      const result = await this.aiSummary.analyze({
        accounts: this.accounts().map((account) => ({ name: account.name, balance: account.balance })),
        categoryTotals,
        budget: this.hasBudget()
          ? { limit: summary.totalLimit, spent: summary.totalSpent, percentage: summary.percentage }
          : null,
      });
      this.analysisResult.set(result);
    } catch (error) {
      this.analysisError.set(error instanceof Error ? error.message : 'Ocurrió un error inesperado.');
    } finally {
      this.analyzing.set(false);
    }
  }
}
