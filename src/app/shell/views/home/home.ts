import { Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';

import { Card } from '../../../shared/card/card';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { ProgressRing } from '../../../shared/progress-ring/progress-ring';
import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { calculateBudgetProgress, calculateBudgetSummary, sumExpensesByCategory } from '../../../core/budget-progress/budget-progress';
import { Budgets } from '../../../core/budgets/budgets';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toMonthKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

@Component({
  selector: 'mfx-home',
  imports: [Card, AnimatedNumber, ProgressRing],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly accountsService = inject(Accounts);
  private readonly budgetsService = inject(Budgets);
  private readonly movementsService = inject(MovementsService);
  private readonly groupsService = inject(GroupsService);
  private readonly auth = inject(Auth);

  readonly accounts = toSignal(this.accountsService.accounts$, { initialValue: [] });
  readonly totalBalance = computed(() => this.accounts().reduce((sum, account) => sum + account.balance, 0));

  private readonly today = new Date();
  private readonly month = toMonthKey(this.today);

  readonly monthLabel = capitalize(
    new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(this.today)
  );

  readonly monthRangeLabel = (() => {
    const lastDay = new Date(this.today.getFullYear(), this.today.getMonth() + 1, 0).getDate();
    const monthName = new Intl.DateTimeFormat('es-CO', { month: 'long' }).format(this.today);
    return `1 – ${lastDay} de ${monthName}`;
  })();

  private readonly currentUid = computed(() => this.auth.currentUser?.uid ?? null);
  private readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  private readonly groupIds = computed(() => this.groups().map((g) => g.id));

  private readonly movements = toSignal(
    toObservable(this.groupIds).pipe(switchMap((groupIds) => this.movementsService.combinedMovements$(groupIds))),
    { initialValue: [] }
  );
  private readonly budgets = toSignal(this.budgetsService.budgetsForMonth$(this.month), { initialValue: [] });

  readonly budgetSummary = computed(() => {
    const spentByCategory = sumExpensesByCategory(this.movements(), this.month, this.currentUid() ?? '');
    const progress = calculateBudgetProgress(this.budgets(), spentByCategory);
    return calculateBudgetSummary(progress);
  });

  // El anillo solo puede dibujar hasta 100% — el aviso de "te pasaste" vive
  // en la vista de Presupuesto, no acá.
  readonly budgetUsedPercent = computed(() => Math.min(100, this.budgetSummary().percentage));
  readonly budgetRingColor = computed(() => {
    const pct = this.budgetSummary().percentage;
    if (pct > 100) return 'var(--danger)';
    if (pct >= 80) return 'var(--accent)';
    return 'var(--primary)';
  });
}
