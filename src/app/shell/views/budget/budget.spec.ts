import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../../../core/auth/auth';
import { Budgets } from '../../../core/budgets/budgets';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { RecurringPaymentFormState } from '../../../core/recurring-payment-form-state/recurring-payment-form-state';
import { RecurringPayments } from '../../../core/recurring-payments/recurring-payments';
import { Budget } from './budget';

const fakeCategories = [
  { id: 'cat-food', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const },
  { id: 'cat-transport', uid: null, name: 'Transporte', icon: '🚌', type: 'expense' as const },
  { id: 'cat-income', uid: null, name: 'Salario', icon: '💼', type: 'income' as const },
];

function ts(date: Date) {
  return { toDate: () => date } as never;
}

function configure(opts: { budgets?: unknown[]; movements?: unknown[]; recurring?: unknown[] } = {}) {
  return TestBed.configureTestingModule({
    imports: [Budget],
    providers: [
      provideNoopAnimations(),
      { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      { provide: GroupsService, useValue: { groups$: of([]) } },
      { provide: MovementsService, useValue: { combinedMovements$: () => of(opts.movements ?? []) } },
      { provide: Budgets, useValue: { budgetsForMonth$: () => of(opts.budgets ?? []), setLimit: vi.fn().mockResolvedValue(undefined) } },
      { provide: RecurringPayments, useValue: { personalRecurringPayments$: of(opts.recurring ?? []) } },
    ],
  }).compileComponents();
}

describe('Budget', () => {
  let component: Budget;
  let fixture: ComponentFixture<Budget>;

  beforeEach(async () => {
    const now = new Date();
    await configure({
      budgets: [{ id: 'b1', uid: 'u1', categoryId: 'cat-food', month: 'x', limit: 200 }],
      movements: [{ categoryId: 'cat-food', amount: 150, type: 'expense', date: ts(now) }],
    });

    fixture = TestBed.createComponent(Budget);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('only lists expense categories', () => {
    expect(component.expenseCategories().map((c) => c.id)).toEqual(['cat-food', 'cat-transport']);
  });

  it('computes progress per category (limit, spent, percentage)', () => {
    expect(component.progressFor('cat-food')).toEqual({ categoryId: 'cat-food', limit: 200, spent: 150, percentage: 75 });
  });

  it('falls back to an unbudgeted (0/0/0) row for a category with no budget yet', () => {
    expect(component.progressFor('cat-transport')).toEqual({ categoryId: 'cat-transport', limit: 0, spent: 0, percentage: 0 });
  });

  it('computes the overall summary across all categories', () => {
    expect(component.summary()).toEqual({ totalLimit: 200, totalSpent: 150, percentage: 75 });
  });

  it('colors under 80% as primary, 80-100% as accent, and over 100% as danger', () => {
    expect(component.ringColor('cat-food')).toBe('var(--primary)'); // 75%
  });

  it('does not show the over-budget alert when nothing is over 100%', () => {
    expect(component.overBudgetCategories().length).toBe(0);
    expect(fixture.nativeElement.querySelector('.mfx-budget__alert')).toBeNull();
  });

  it('builds one editable limit control per expense category, defaulted from the existing budget', () => {
    expect(component.limitsForm.controls['cat-food'].value).toBe(200);
    expect(component.limitsForm.controls['cat-transport'].value).toBe(0);
  });

  it('saveLimits() persists every category limit', async () => {
    const budgetsService = TestBed.inject(Budgets);
    component.limitsForm.controls['cat-food'].setValue(300);

    await component.saveLimits();

    expect(budgetsService.setLimit).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-food', limit: 300 }));
    expect(budgetsService.setLimit).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-transport', limit: 0 }));
  });

  it('shows an inline error if saveLimits() fails, without throwing', async () => {
    const budgetsService = TestBed.inject(Budgets);
    vi.mocked(budgetsService.setLimit).mockRejectedValue(new Error('boom'));

    await component.saveLimits();

    expect(component.limitsError()).toBe('No pudimos guardar el presupuesto. Intenta de nuevo.');
  });

  it('rejects a negative limit', () => {
    component.limitsForm.controls['cat-food'].setValue(-10);
    expect(component.limitsForm.invalid).toBe(true);
  });

  it('shows the empty state for recurring payments', () => {
    expect(fixture.nativeElement.textContent).toContain('No tienes pagos recurrentes todavía');
  });

  it('openCreateRecurring() opens the shared form state in create mode', () => {
    const state = TestBed.inject(RecurringPaymentFormState);
    component.openCreateRecurring();
    expect(state.request()).toEqual({ mode: 'create' });
  });

  it('openEditRecurring() opens the shared form state with the given payment', () => {
    const state = TestBed.inject(RecurringPaymentFormState);
    const payment = { id: 'r1' } as never;
    component.openEditRecurring(payment);
    expect(state.request()).toEqual({ mode: 'edit', payment });
  });
});

describe('Budget when a category is over budget', () => {
  let fixture: ComponentFixture<Budget>;
  let component: Budget;

  beforeEach(async () => {
    const now = new Date();
    await configure({
      budgets: [{ id: 'b1', uid: 'u1', categoryId: 'cat-food', month: 'x', limit: 100 }],
      movements: [{ categoryId: 'cat-food', amount: 150, type: 'expense', date: ts(now) }],
    });

    fixture = TestBed.createComponent(Budget);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('flags the category as over budget', () => {
    expect(component.overBudgetCategories().map((p) => p.categoryId)).toEqual(['cat-food']);
  });

  it('shows the visible (non-alert()) warning card naming the category', () => {
    const alert = fixture.nativeElement.querySelector('.mfx-budget__alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('Comida');
  });

  it('colors the ring red', () => {
    expect(component.ringColor('cat-food')).toBe('var(--danger)');
  });

  it('caps the ring percentage visually at 100 even though the real value is higher', () => {
    expect(component.ringPercentage('cat-food')).toBe(100);
    expect(component.progressFor('cat-food').percentage).toBe(150);
  });
});

describe('Budget with recurring payments', () => {
  let fixture: ComponentFixture<Budget>;

  beforeEach(async () => {
    await configure({
      recurring: [
        { id: 'r1', uid: 'u1', groupId: null, name: 'Netflix', amount: 30000, active: true },
        { id: 'r2', uid: 'u1', groupId: null, name: 'Gimnasio', amount: 80000, active: false },
      ],
    });

    fixture = TestBed.createComponent(Budget);
    fixture.detectChanges();
  });

  it('renders a card per recurring payment with its active/inactive status', () => {
    const rows = fixture.nativeElement.querySelectorAll('.mfx-budget__recurring-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Netflix');
    expect(rows[0].textContent).toContain('Activo');
    expect(rows[1].textContent).toContain('Inactivo');
  });
});
