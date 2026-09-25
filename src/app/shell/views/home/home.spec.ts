import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';

import { Home } from './home';
import { ActiveTabState } from '../../../core/active-tab-state/active-tab-state';
import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { BalancesModalState } from '../../../core/balances-modal-state/balances-modal-state';
import { Budgets } from '../../../core/budgets/budgets';
import { Categories } from '../../../core/categories/categories';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { RecurringPayments } from '../../../core/recurring-payments/recurring-payments';
import { SettlementsService } from '../../../core/settlements/settlements';
import { ThemeService } from '../../../core/theme/theme';

// Chart.js necesita un <canvas> con un contexto 2D real, que jsdom no
// implementa (mismo motivo que canvas-confetti se mockea en
// celebration.spec.ts) — se reemplaza toda la librería por un stub que
// registra la config recibida, para poder verificar los datos sin depender
// de un canvas real.
const { MockChart, chartInstances } = vi.hoisted(() => {
  const chartInstances: {
    type: string;
    data: {
      labels: unknown[];
      datasets: { data: unknown[]; backgroundColor?: unknown; borderColor?: unknown; pointBackgroundColor?: unknown }[];
    };
    options: Record<string, unknown>;
    destroy: () => void;
    update: () => void;
  }[] = [];

  class MockChart {
    static register = vi.fn();
    data: (typeof chartInstances)[number]['data'];
    options: Record<string, unknown>;
    type: string;
    destroy = vi.fn();
    update = vi.fn();

    constructor(_canvas: unknown, config: { type: string; data: (typeof chartInstances)[number]['data']; options: Record<string, unknown> }) {
      this.type = config.type;
      this.data = config.data;
      this.options = config.options;
      chartInstances.push(this as never);
    }
  }

  return { MockChart, chartInstances };
});

vi.mock('chart.js', () => ({ Chart: MockChart, registerables: [] }));

const fakeAccounts = [
  { id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 100000, currency: 'COP' },
  { id: 'acc2', uid: 'u1', name: 'Banco', type: 'banco' as const, balance: 250000, currency: 'COP' },
];

const fakeCategories = [
  { id: 'cat-food', uid: null, name: 'Mercado', icon: '🛒', type: 'expense' as const },
  { id: 'cat-transport', uid: null, name: 'Transporte', icon: '🚌', type: 'expense' as const },
];

const group1 = { id: 'group1', name: 'Apartamento', members: ['u1', 'u2'], createdBy: 'u1', createdAt: {} as never };

function ts(date: Date) {
  return { toDate: () => date, toMillis: () => date.getTime() } as never;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

function configure(
  overrides: {
    budgets?: unknown[];
    movements?: unknown[];
    groups?: unknown[];
    recurringPayments?: unknown[];
    allGroupMovements?: unknown[];
    allGroupSettlements?: unknown[];
    getMemberProfiles?: ReturnType<typeof vi.fn>;
    themeSignal?: ReturnType<typeof signal<'dark' | 'light'>>;
  } = {}
) {
  return TestBed.configureTestingModule({
    imports: [Home],
    providers: [
      provideNoopAnimations(),
      // Home reconstruye los colores de las gráficas cuando el tema cambia
      // en vivo (ver ThemeService en su constructor) — un stub controlable
      // por el test en vez del servicio real, que llamaría a
      // @capacitor/preferences de verdad (ver theme.spec.ts para ese).
      { provide: ThemeService, useValue: { theme: overrides.themeSignal ?? signal('dark') } },
      { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
      { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      { provide: GroupsService, useValue: { groups$: of(overrides.groups ?? []), getMemberProfiles: overrides.getMemberProfiles ?? vi.fn().mockResolvedValue([]) } },
      {
        provide: MovementsService,
        useValue: {
          combinedMovements$: () => of(overrides.movements ?? []),
          allSharedMovementsForGroups$: () => of(overrides.allGroupMovements ?? []),
          countGroupMovements: vi.fn().mockResolvedValue(0),
        },
      },
      {
        // GroupActivity (renderizado dentro de Home para "Gastos
        // compartidos recientes") lo inyecta directamente — se stubea vacío
        // acá, ya que su combinación/orden/etiqueta se prueba a fondo en su
        // propio spec.
        provide: SettlementsService,
        useValue: {
          settlementsForGroups$: () => of(overrides.allGroupSettlements ?? []),
          findLinkedMovementSettlementIds: vi.fn().mockResolvedValue(new Set()),
          countGroupSettlements: vi.fn().mockResolvedValue(0),
        },
      },
      { provide: Budgets, useValue: { budgetsForMonth$: () => of(overrides.budgets ?? []) } },
      { provide: RecurringPayments, useValue: { personalRecurringPayments$: of(overrides.recurringPayments ?? []) } },
    ],
  }).compileComponents();
}

describe('Home', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;

  beforeEach(async () => {
    await configure();

    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('sums the balance of all accounts for the hero total', () => {
    expect(component.totalBalance()).toBe(350000);
  });

  it('formats the month header capitalized, in Spanish, without a hardcoded month array', () => {
    const now = new Date();
    const expected = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
      .format(now)
      .replace(/^./, (c) => c.toUpperCase());

    expect(component.monthLabel).toBe(expected);
  });

  it('formats the active date range as "1 – <lastDay> de <mes>"', () => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthName = new Intl.DateTimeFormat('es-CO', { month: 'long' }).format(now);

    expect(component.monthRangeLabel).toBe(`1 – ${lastDay} de ${monthName}`);
  });

  it('shows 0% with no budgets at all', () => {
    expect(component.budgetUsedPercent()).toBe(0);
  });

  it('opens the balances modal when the hero card is tapped', () => {
    const balancesModalState = TestBed.inject(BalancesModalState);

    fixture.nativeElement.querySelector('.mfx-home__hero').click();

    expect(balancesModalState.open()).toBe(true);
  });

  it('shows the empty state for movements, shared activity, upcoming payments and groups with no data', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Todavía no tienes movimientos registrados');
    expect(text).toContain('Todavía no hay actividad en este grupo');
    expect(text).toContain('No tienes pagos recurrentes activos');
    expect(text).toContain('Todavía no perteneces a ningún grupo');
  });

  it('navigates to Movimientos/Grupos/Recurrentes when a section header is tapped', () => {
    const activeTabState = TestBed.inject(ActiveTabState);
    const headers = Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('.mfx-home__section-header'));

    headers.find((h) => h.textContent?.includes('Últimos movimientos'))!.click();
    expect(activeTabState.requestedIndex()).toBe(1);
    activeTabState.consume();

    headers.find((h) => h.textContent?.includes('Gastos compartidos recientes'))!.click();
    expect(activeTabState.requestedIndex()).toBe(2);
    activeTabState.consume();

    headers.find((h) => h.textContent?.includes('Próximos a vencer'))!.click();
    expect(activeTabState.requestedIndex()).toBe(3);
    activeTabState.consume();

    headers.find((h) => h.textContent?.includes('Tus grupos'))!.click();
    expect(activeTabState.requestedIndex()).toBe(2);
  });
});

describe('Home with a real budget this month', () => {
  let component: Home;

  beforeEach(async () => {
    const now = new Date();
    await configure({
      budgets: [{ id: 'b1', uid: 'u1', categoryId: 'cat-food', month: 'irrelevant-for-this-stub', limit: 200 }],
      movements: [{ id: 'm1', categoryId: 'cat-food', amount: 150, type: 'expense', date: ts(now) }],
    });

    const fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('computes the real spent/limit percentage for the ring', () => {
    expect(component.budgetUsedPercent()).toBe(75);
    expect(component.budgetRingColor()).toBe('var(--primary)');
  });
});

describe('Home recentMovements()', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;

  beforeEach(async () => {
    const now = new Date();
    const older = new Date(now.getTime() - 60 * 60 * 1000);
    const newest = new Date(now.getTime() + 60 * 60 * 1000);

    await configure({
      groups: [group1],
      movements: [
        { id: 'm-personal', categoryId: 'cat-food', amount: 50, type: 'expense', date: ts(older), groupId: null },
        { id: 'm-shared', categoryId: 'cat-transport', amount: 30, type: 'expense', date: ts(newest), groupId: 'group1' },
      ],
    });

    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('sorts personal + shared movements by date descending and maps category/group names', () => {
    const items = component.recentMovements();

    expect(items.length).toBe(2);
    expect(items[0]).toEqual({
      id: 'm-shared',
      categoryIcon: '🚌',
      categoryName: 'Transporte',
      amount: 30,
      type: 'expense',
      groupName: 'Apartamento',
      dateLabel: expect.any(String),
    });
    expect(items[1].id).toBe('m-personal');
    expect(items[1].groupName).toBeNull();
  });

  it('caps the list at 3, even with more movements', async () => {
    const now = new Date();
    TestBed.resetTestingModule();
    await configure({
      movements: Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        categoryId: 'cat-food',
        amount: 10,
        type: 'expense',
        date: ts(new Date(now.getTime() - i * 1000)),
        groupId: null,
      })),
    });
    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.recentMovements().length).toBe(3);
  });
});

describe('Home "Gastos compartidos recientes" (wiring into GroupActivity)', () => {
  // La combinación multi-grupo, el orden, el límite de 5 y la etiqueta de
  // grupo ya se prueban a fondo en group-activity.spec.ts (describe
  // "GroupActivity with multiple groupIds") — acá solo se verifica que Home
  // le pase LOS DATOS CORRECTOS: todos sus grupos (no solo los 3 de "Tus
  // grupos") y los perfiles de miembros de todos ellos.
  const group2 = { id: 'group2', name: 'Viaje', members: ['u1'], createdBy: 'u1', createdAt: {} as never };
  const group3 = { id: 'group3', name: 'Oficina', members: ['u1'], createdBy: 'u1', createdAt: {} as never };
  const group4 = { id: 'group4', name: 'Familia', members: ['u1'], createdBy: 'u1', createdAt: {} as never };

  it('exposes every group id (not capped at 3) and the flattened member profiles of all of them', async () => {
    const getMemberProfiles = vi.fn().mockResolvedValue([{ uid: 'u1', displayName: 'Diego', email: '', photoURL: '' }]);
    await configure({ groups: [group1, group2, group3, group4], getMemberProfiles });

    const fixture = TestBed.createComponent(Home);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();

    expect(component.groupIds()).toEqual(['group1', 'group2', 'group3', 'group4']);
    expect(getMemberProfiles).toHaveBeenCalledTimes(4);
    expect(component.allMemberProfiles().length).toBe(4);
  });

  it('renders the shared activity feed (via mfx-group-activity) with the group name tag once there is more than one group', async () => {
    await configure({
      groups: [group1, group2],
      allGroupMovements: [
        {
          id: 's1',
          groupId: 'group1',
          categoryId: 'cat-food',
          amount: 100,
          type: 'expense',
          date: ts(new Date()),
          paidBy: 'u1',
          splits: [],
        },
      ],
    });

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-group-activity')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Apartamento');
  });
});

describe('Home upcomingRecurring()', () => {
  it('sorts active recurring payments by nextDate ascending, formats "en N días", and excludes inactive ones', async () => {
    const today = new Date();
    const inThreeDays = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3);
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    await configure({
      recurringPayments: [
        { id: 'p-far', name: 'Netflix', amount: 30000, active: true, nextDate: ts(inThreeDays) },
        { id: 'p-near', name: 'Arriendo', amount: 900000, active: true, nextDate: ts(tomorrow) },
        { id: 'p-inactive', name: 'Gym', amount: 50000, active: false, nextDate: ts(tomorrow) },
      ],
    });
    const fixture = TestBed.createComponent(Home);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const items = component.upcomingRecurring();
    expect(items.map((i) => i.id)).toEqual(['p-near', 'p-far']);
    expect(items[0].dueLabel).toBe('Mañana');
    expect(items[1].dueLabel).toBe('En 3 días');
  });

  it('formats an overdue payment as "Venció hace N días"', async () => {
    const today = new Date();
    const twoDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2);

    await configure({
      recurringPayments: [{ id: 'p-overdue', name: 'Luz', amount: 60000, active: true, nextDate: ts(twoDaysAgo) }],
    });
    const fixture = TestBed.createComponent(Home);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.upcomingRecurring()[0].dueLabel).toBe('Venció hace 2 días');
  });
});

describe('Home topGroups() and member avatars', () => {
  it('loads member profiles per group and exposes up to 3 groups', async () => {
    const getMemberProfiles = vi.fn().mockResolvedValue([{ uid: 'u1', displayName: 'Diego', email: '', photoURL: '' }]);
    await configure({ groups: [group1], getMemberProfiles });

    const fixture = TestBed.createComponent(Home);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();

    expect(getMemberProfiles).toHaveBeenCalledWith('group1');
    expect(component.groupMembers('group1').length).toBe(1);
    expect(component.topGroups().length).toBe(1);
  });

  it('opens the group detail state when a group card is tapped', async () => {
    await configure({ groups: [group1] });
    const fixture = TestBed.createComponent(Home);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();

    const groupDetailState = TestBed.inject(GroupDetailState);
    component.openGroup(group1);

    expect(groupDetailState.groupId()).toBe('group1');
  });
});

describe('Home charts', () => {
  beforeEach(() => {
    chartInstances.length = 0;
  });

  it('creates a line chart for the monthly trend with one point per month', async () => {
    const now = new Date();
    await configure({ movements: [{ id: 'm1', categoryId: 'cat-food', amount: 100, type: 'expense', date: ts(now), groupId: null }] });

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const trend = chartInstances.find((c) => c.type === 'line');
    expect(trend).toBeTruthy();
    expect(trend!.data.labels?.length).toBe(6);
    expect(trend!.data.datasets[0].data.at(-1)).toBe(100);
  });

  it('creates a doughnut chart for category spend when there is expense data this month', async () => {
    const now = new Date();
    await configure({
      movements: [
        { id: 'm1', categoryId: 'cat-food', amount: 100, type: 'expense', date: ts(now), groupId: null },
        { id: 'm2', categoryId: 'cat-transport', amount: 40, type: 'expense', date: ts(now), groupId: null },
      ],
    });

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const category = chartInstances.find((c) => c.type === 'doughnut');
    expect(category).toBeTruthy();
    expect(category!.data.labels).toEqual(['Mercado', 'Transporte']);
    expect(category!.data.datasets[0].data).toEqual([100, 40]);
  });

  it('does not render the category chart card with no expenses this month', async () => {
    await configure({ movements: [] });
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    expect(chartInstances.find((c) => c.type === 'doughnut')).toBeUndefined();
  });
});

describe('Home charts follow the theme (Fase 8 fix)', () => {
  // getComputedStyle real de jsdom no resuelve custom properties sin la
  // hoja de estilos real cargada — se mockea directamente para controlar
  // qué "resuelve" cada token, igual que lo haría el navegador real con
  // styles.scss aplicado.
  function mockResolvedColors(values: Record<string, string>) {
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({ getPropertyValue: (prop: string) => values[prop] ?? '' }) as CSSStyleDeclaration)
    );
  }

  beforeEach(() => {
    // chartInstances es un array a nivel de módulo, compartido por TODOS
    // los tests del archivo — sin esto, .find() puede devolver un chart
    // creado por un test ANTERIOR (de otro describe) en vez del que
    // acabamos de crear acá.
    chartInstances.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads chart colors from the CURRENT resolved theme tokens (getComputedStyle), not a hardcoded value', async () => {
    mockResolvedColors({
      '--text': '#060b14',
      '--primary': '#008561',
      '--mfx-hairline-subtle': 'rgba(6, 11, 20, 0.08)',
    });
    const now = new Date();
    await configure({
      themeSignal: signal('light'),
      movements: [{ id: 'm1', categoryId: 'cat-food', amount: 100, type: 'expense', date: ts(now), groupId: null }],
    });

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const trend = chartInstances.find((c) => c.type === 'line')!;
    expect(trend.data.datasets[0].borderColor).toBe('#008561');
    const scales = trend.options['scales'] as { x: { ticks: { color: string } } };
    expect(scales.x.ticks.color).toBe('#060b14');
  });

  it('rebuilds the chart colors live when the theme changes, without reloading the view', async () => {
    mockResolvedColors({ '--text': '#f5f7fa', '--primary': '#00e6a8', '--mfx-hairline-subtle': 'rgba(245, 247, 250, 0.08)' });
    const themeSignal = signal<'dark' | 'light'>('dark');
    const now = new Date();
    await configure({
      themeSignal,
      movements: [{ id: 'm1', categoryId: 'cat-food', amount: 100, type: 'expense', date: ts(now), groupId: null }],
    });

    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const trend = chartInstances.find((c) => c.type === 'line')!;
    expect(trend.data.datasets[0].borderColor).toBe('#00e6a8');

    // El usuario cambia a modo claro EN VIVO, sin recargar Inicio.
    mockResolvedColors({ '--text': '#060b14', '--primary': '#008561', '--mfx-hairline-subtle': 'rgba(6, 11, 20, 0.08)' });
    themeSignal.set('light');
    fixture.detectChanges();

    expect(trend.data.datasets[0].borderColor).toBe('#008561');
    const scales = trend.options['scales'] as { x: { ticks: { color: string } } };
    expect(scales.x.ticks.color).toBe('#060b14');
  });
});
