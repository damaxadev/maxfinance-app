import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { Chart, registerables } from 'chart.js';

import { Card } from '../../../shared/card/card';
import { Avatar } from '../../../shared/avatar/avatar';
import { AnimatedNumber } from '../../../shared/animated-number/animated-number';
import { ProgressRing } from '../../../shared/progress-ring/progress-ring';
import { ActiveTabState } from '../../../core/active-tab-state/active-tab-state';
import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { BalancesModalState } from '../../../core/balances-modal-state/balances-modal-state';
import {
  calculateBudgetProgress,
  calculateBudgetSummary,
  sumExpensesByCategory,
  sumExpensesByMonth,
} from '../../../core/budget-progress/budget-progress';
import { Budgets } from '../../../core/budgets/budgets';
import { Categories } from '../../../core/categories/categories';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupsService, type GroupMemberProfile, type GroupWithId } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { RecurringPayments } from '../../../core/recurring-payments/recurring-payments';
import type { MovementType } from '../../../models/movement.model';
import { GroupActivity } from '../../../features/groups/group-activity/group-activity';

Chart.register(...registerables);

const MAX_STACKED_AVATARS = 3;
const TREND_MONTHS = 6;
const CHART_COLORS = ['#00E6A8', '#FFD166', '#FF6B6B', '#5AC8FA', '#B388FF', '#FF8FB1'];

interface HomeMovementItem {
  id: string;
  categoryIcon: string;
  categoryName: string;
  amount: number;
  type: MovementType;
  groupName: string | null;
  dateLabel: string;
}

interface UpcomingRecurringItem {
  id: string;
  name: string;
  amount: number;
  dueLabel: string;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toMonthKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function monthKeyToDate(month: string): Date {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 1);
}

// "en 3 días" / "mañana" / "hoy" / "venció hace 2 días" — nextDate puede
// quedar en el pasado si la Cloud Function programada todavía no procesó
// ese pago (corre una vez al día), así que también hay que cubrir ese caso.
function formatDueLabel(nextDate: Date, now: Date): string {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfDay(nextDate) - startOfDay(now)) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Mañana';
  if (diffDays > 1) return `En ${diffDays} días`;
  if (diffDays === -1) return 'Venció hace 1 día';
  return `Venció hace ${-diffDays} días`;
}

@Component({
  selector: 'mfx-home',
  imports: [Card, Avatar, AnimatedNumber, ProgressRing, GroupActivity],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  private readonly accountsService = inject(Accounts);
  private readonly budgetsService = inject(Budgets);
  private readonly categoriesService = inject(Categories);
  private readonly movementsService = inject(MovementsService);
  private readonly groupsService = inject(GroupsService);
  private readonly recurringPaymentsService = inject(RecurringPayments);
  private readonly auth = inject(Auth);

  readonly activeTabState = inject(ActiveTabState);
  readonly balancesModalState = inject(BalancesModalState);
  readonly groupDetailState = inject(GroupDetailState);

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

  private readonly categories = toSignal(this.categoriesService.categories$, { initialValue: [] });
  private readonly categoriesById = computed(() => new Map(this.categories().map((category) => [category.id, category])));

  readonly groups = toSignal(this.groupsService.groups$, { initialValue: [] });
  private readonly groupsById = computed(() => new Map(this.groups().map((group) => [group.id, group])));
  readonly groupIds = computed(() => this.groups().map((group) => group.id));

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

  // "Últimos movimientos" — mismo criterio que la vista de Movimientos
  // (personales + compartidos que el usuario registró), solo los 3 más
  // recientes de toda la lista (sin acotar al mes activo: es "lo último
  // que pasó", no un resumen del mes).
  readonly recentMovements = computed<HomeMovementItem[]>(() =>
    [...this.movements()]
      .sort((a, b) => b.date.toMillis() - a.date.toMillis())
      .slice(0, 3)
      .map((movement) => ({
        id: movement.id,
        categoryIcon: this.categoriesById().get(movement.categoryId)?.icon ?? '❓',
        categoryName: this.categoriesById().get(movement.categoryId)?.name ?? 'Categoría eliminada',
        amount: movement.amount,
        type: movement.type,
        groupName: movement.groupId === null ? null : this.groupsById().get(movement.groupId)?.name ?? 'Grupo',
        dateLabel: movement.date.toDate().toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }),
      }))
  );

  // "Próximos a vencer" — los 3 pagos recurrentes activos con nextDate más
  // cercana, ascendente.
  private readonly recurringPayments = toSignal(this.recurringPaymentsService.personalRecurringPayments$, {
    initialValue: [],
  });

  readonly upcomingRecurring = computed<UpcomingRecurringItem[]>(() => {
    const now = new Date();
    return this.recurringPayments()
      .filter((payment) => payment.active)
      .sort((a, b) => a.nextDate.toMillis() - b.nextDate.toMillis())
      .slice(0, 3)
      .map((payment) => ({
        id: payment.id,
        name: payment.name,
        amount: payment.amount,
        dueLabel: formatDueLabel(payment.nextDate.toDate(), now),
      }));
  });

  // "Tus grupos" — hasta 3, con el mismo patrón de avatares apilados que la
  // vista de Grupos (perfiles cargados una vez por grupo, cacheados en un Map).
  readonly maxStackedAvatars = MAX_STACKED_AVATARS;
  readonly topGroups = computed(() => this.groups().slice(0, 3));
  private readonly memberProfilesByGroup = signal<Map<string, GroupMemberProfile[]>>(new Map());

  // Gráficas (Chart.js) — ver los `effect()` del constructor para la
  // creación/actualización imperativa de los <canvas>.
  private readonly trendCanvas = viewChild<ElementRef<HTMLCanvasElement>>('trendCanvas');
  private readonly categoryCanvas = viewChild<ElementRef<HTMLCanvasElement>>('categoryCanvas');
  private trendChart: Chart | null = null;
  private categoryChart: Chart | null = null;

  readonly monthlyTrend = computed(() => sumExpensesByMonth(this.movements(), this.currentUid() ?? '', this.today, TREND_MONTHS));

  readonly categorySpend = computed(() => {
    const spentByCategory = sumExpensesByCategory(this.movements(), this.month, this.currentUid() ?? '');
    return [...spentByCategory.entries()]
      .map(([categoryId, total]) => ({ label: this.categoriesById().get(categoryId)?.name ?? 'Categoría eliminada', total }))
      .sort((a, b) => b.total - a.total);
  });

  readonly hasCategorySpend = computed(() => this.categorySpend().length > 0);

  constructor() {
    effect(() => {
      for (const group of this.groups()) {
        if (this.memberProfilesByGroup().has(group.id)) {
          continue;
        }
        this.groupsService
          .getMemberProfiles(group.id)
          .then((profiles) => {
            const next = new Map(this.memberProfilesByGroup());
            next.set(group.id, profiles);
            this.memberProfilesByGroup.set(next);
          })
          .catch((error) => console.error('Error al cargar los miembros del grupo', error));
      }
    });

    effect(() => {
      const canvas = this.trendCanvas()?.nativeElement;
      const data = this.monthlyTrend();
      if (!canvas) {
        return;
      }
      const labels = data.map((entry) => capitalize(new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(monthKeyToDate(entry.month))));
      const values = data.map((entry) => entry.total);

      if (this.trendChart) {
        this.trendChart.data.labels = labels;
        this.trendChart.data.datasets[0].data = values;
        this.trendChart.update();
        return;
      }
      this.trendChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              data: values,
              borderColor: '#00E6A8',
              backgroundColor: 'rgba(0, 230, 168, 0.15)',
              fill: true,
              tension: 0.35,
              pointBackgroundColor: '#00E6A8',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#F5F7FA' }, grid: { color: 'rgba(245, 247, 250, 0.08)' } },
            y: { ticks: { color: '#F5F7FA' }, grid: { color: 'rgba(245, 247, 250, 0.08)' }, beginAtZero: true },
          },
        },
      });
    });

    effect(() => {
      const canvas = this.categoryCanvas()?.nativeElement;
      const entries = this.categorySpend();
      if (!canvas || entries.length === 0) {
        return;
      }
      const labels = entries.map((entry) => entry.label);
      const values = entries.map((entry) => entry.total);
      const colors = entries.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

      if (this.categoryChart) {
        this.categoryChart.data.labels = labels;
        this.categoryChart.data.datasets[0].data = values;
        this.categoryChart.data.datasets[0].backgroundColor = colors;
        this.categoryChart.update();
        return;
      }
      this.categoryChart = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#F5F7FA', boxWidth: 12 } } },
        },
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.trendChart?.destroy();
      this.categoryChart?.destroy();
    });
  }

  groupMembers(groupId: string): GroupMemberProfile[] {
    return this.memberProfilesByGroup().get(groupId) ?? [];
  }

  // "Gastos compartidos recientes" reutiliza <mfx-group-activity> con TODOS
  // los grupos del usuario a la vez (ver DESIGN.md) — necesita los perfiles
  // de miembros de todos ellos, no solo de los que se muestran en "Tus
  // grupos" (que sí está limitado a 3); memberProfilesByGroup ya los carga
  // para cada grupo real, sin ese límite.
  readonly allMemberProfiles = computed(() => [...this.memberProfilesByGroup().values()].flat());

  openGroup(group: GroupWithId): void {
    this.groupDetailState.open(group.id);
  }
}
