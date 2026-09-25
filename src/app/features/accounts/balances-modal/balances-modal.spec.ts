import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { BalancesModal } from './balances-modal';
import { Accounts } from '../../../core/accounts/accounts';
import { AiSummary } from '../../../core/ai-summary/ai-summary';
import { Auth } from '../../../core/auth/auth';
import { Budgets } from '../../../core/budgets/budgets';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { MonthlyInsights } from '../../../core/monthly-insights/monthly-insights';
import { MovementsService } from '../../../core/movements/movements';

const fakeAccounts = [
  { id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 100000, currency: 'COP' },
  { id: 'acc2', uid: 'u1', name: 'Banco', type: 'banco' as const, balance: 250000, currency: 'COP' },
];

const fakeCategories = [{ id: 'cat-food', uid: null, name: 'Mercado', icon: '🛒', type: 'expense' as const }];

function ts(date: Date) {
  return { toDate: () => date } as never;
}

function configure(
  overrides: {
    budgets?: unknown[];
    movements?: unknown[];
    analyze?: ReturnType<typeof vi.fn>;
    lastMonthInsight?: unknown;
  } = {}
) {
  return TestBed.configureTestingModule({
    imports: [BalancesModal],
    providers: [
      provideNoopAnimations(),
      { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
      { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      { provide: GroupsService, useValue: { groups$: of([]) } },
      { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      { provide: MovementsService, useValue: { combinedMovements$: () => of(overrides.movements ?? []) } },
      { provide: Budgets, useValue: { budgetsForMonth$: () => of(overrides.budgets ?? []) } },
      { provide: AiSummary, useValue: { analyze: overrides.analyze ?? vi.fn() } },
      { provide: MonthlyInsights, useValue: { lastMonthInsight$: of(overrides.lastMonthInsight ?? null) } },
    ],
  }).compileComponents();
}

describe('BalancesModal', () => {
  let component: BalancesModal;
  let fixture: ComponentFixture<BalancesModal>;

  beforeEach(async () => {
    await configure();
    fixture = TestBed.createComponent(BalancesModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('sums the balance of all accounts for the hero total', () => {
    expect(component.totalBalance()).toBe(350000);
  });

  it('renders one row per account', () => {
    const rows = fixture.nativeElement.querySelectorAll('.mfx-balances-modal__account');
    expect(rows.length).toBe(2);
  });

  it('has no cached-age label before any analysis has run', () => {
    expect(component.cachedAgeLabel()).toBeNull();
  });
});

describe('BalancesModal analyzeBalances()', () => {
  let component: BalancesModal;
  let fixture: ComponentFixture<BalancesModal>;
  let analyze: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    analyze = vi.fn().mockResolvedValue({
      summary: 'Te fue bien este mes.',
      cached: false,
      generatedAt: new Date().toISOString(),
    });

    await configure({
      budgets: [{ id: 'b1', uid: 'u1', categoryId: 'cat-food', month: 'irrelevant', limit: 200000 }],
      movements: [{ categoryId: 'cat-food', amount: 50000, type: 'expense', date: ts(new Date()) }],
      analyze,
    });

    fixture = TestBed.createComponent(BalancesModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('sends accounts, category totals (by name) and the budget summary to AiSummary', async () => {
    await component.analyzeBalances();

    expect(analyze).toHaveBeenCalledWith({
      accounts: [
        { name: 'Efectivo', balance: 100000 },
        { name: 'Banco', balance: 250000 },
      ],
      categoryTotals: [{ category: 'Mercado', total: 50000 }],
      budget: { limit: 200000, spent: 50000, percentage: 25 },
    });
  });

  it('toggles analyzing() while the call is in flight and stores the result', async () => {
    const promise = component.analyzeBalances();
    expect(component.analyzing()).toBe(true);

    await promise;

    expect(component.analyzing()).toBe(false);
    expect(component.analysisResult()?.summary).toBe('Te fue bien este mes.');
    expect(component.analysisError()).toBeNull();
  });

  it('sets a friendly error and clears analyzing() when the call fails', async () => {
    analyze.mockRejectedValue(new Error('No se pudo generar el análisis. Intenta de nuevo más tarde.'));

    await component.analyzeBalances();

    expect(component.analyzing()).toBe(false);
    expect(component.analysisError()).toBe('No se pudo generar el análisis. Intenta de nuevo más tarde.');
    expect(component.analysisResult()).toBeNull();
  });
});

describe('BalancesModal with no budget configured this month', () => {
  it('sends budget: null', async () => {
    const analyze = vi.fn().mockResolvedValue({ summary: 'x', cached: false, generatedAt: new Date().toISOString() });
    await configure({ analyze });

    const fixture = TestBed.createComponent(BalancesModal);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    await component.analyzeBalances();

    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ budget: null }));
  });
});

describe('BalancesModal cachedAgeLabel()', () => {
  let component: BalancesModal;
  let fixture: ComponentFixture<BalancesModal>;

  beforeEach(async () => {
    await configure();
    fixture = TestBed.createComponent(BalancesModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function setResult(cached: boolean, hoursAgo: number) {
    component.analysisResult.set({
      summary: 'x',
      cached,
      generatedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
    });
  }

  it('is null when the latest result was freshly generated (not cached)', () => {
    setResult(false, 0);
    expect(component.cachedAgeLabel()).toBeNull();
  });

  it('says "menos de una hora" for a cached result generated under an hour ago', () => {
    setResult(true, 0.2);
    expect(component.cachedAgeLabel()).toBe('menos de una hora');
  });

  it('uses the singular for exactly 1 hour', () => {
    setResult(true, 1);
    expect(component.cachedAgeLabel()).toBe('1 hora');
  });

  it('uses the plural for more than 1 hour', () => {
    setResult(true, 5);
    expect(component.cachedAgeLabel()).toBe('5 horas');
  });
});

describe('BalancesModal lastMonthInsight (Fase 8)', () => {
  it('shows nothing when there is no insight for last month', async () => {
    await configure({ lastMonthInsight: null });
    const fixture = TestBed.createComponent(BalancesModal);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.mfx-balances-modal__analysis')).toBeNull();
  });

  it('reuses the analysis card to show the automatically generated monthly insight', async () => {
    await configure({
      lastMonthInsight: { uid: 'u1', month: '2026-02', text: 'Te fue bien en febrero.', generatedAt: {}, notifiedAt: {} },
    });
    const fixture = TestBed.createComponent(BalancesModal);
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.mfx-balances-modal__analysis');
    expect(card.textContent).toContain('Te fue bien en febrero.');
    expect(fixture.nativeElement.textContent).toContain('Resumen de febrero de 2026');
  });
});
