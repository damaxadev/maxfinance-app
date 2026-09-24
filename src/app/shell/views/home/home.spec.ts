import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { Home } from './home';
import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Budgets } from '../../../core/budgets/budgets';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';

const fakeAccounts = [
  { id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 100000, currency: 'COP' },
  { id: 'acc2', uid: 'u1', name: 'Banco', type: 'banco' as const, balance: 250000, currency: 'COP' },
];

function ts(date: Date) {
  return { toDate: () => date } as never;
}

function configure(providersOverrides: {
  budgets?: unknown[];
  movements?: unknown[];
} = {}) {
  return TestBed.configureTestingModule({
    imports: [Home],
    providers: [
      provideNoopAnimations(),
      { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
      { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      { provide: GroupsService, useValue: { groups$: of([]) } },
      {
        provide: MovementsService,
        useValue: { combinedMovements$: () => of(providersOverrides.movements ?? []) },
      },
      { provide: Budgets, useValue: { budgetsForMonth$: () => of(providersOverrides.budgets ?? []) } },
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

  it('renders one card per account', () => {
    const rows = fixture.nativeElement.querySelectorAll('.mfx-home__account');
    expect(rows.length).toBe(2);
  });

  it('formats the month header capitalized, in Spanish, without a hardcoded month array', () => {
    const now = new Date();
    const expected =
      new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
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
});

describe('Home with a real budget this month', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;

  beforeEach(async () => {
    const now = new Date();
    await configure({
      budgets: [{ id: 'b1', uid: 'u1', categoryId: 'cat-food', month: 'irrelevant-for-this-stub', limit: 200 }],
      movements: [
        { categoryId: 'cat-food', amount: 150, type: 'expense', date: ts(now) },
      ],
    });

    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('computes the real spent/limit percentage for the ring', () => {
    expect(component.budgetUsedPercent()).toBe(75);
    expect(component.budgetRingColor()).toBe('var(--primary)');
  });
});

describe('Home when spending is over budget', () => {
  let component: Home;
  let fixture: ComponentFixture<Home>;

  beforeEach(async () => {
    const now = new Date();
    await configure({
      budgets: [{ id: 'b1', uid: 'u1', categoryId: 'cat-food', month: 'irrelevant', limit: 100 }],
      movements: [{ categoryId: 'cat-food', amount: 150, type: 'expense', date: ts(now) }],
    });

    fixture = TestBed.createComponent(Home);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('caps the ring visually at 100% even though the real percentage is higher', () => {
    expect(component.budgetUsedPercent()).toBe(100);
  });

  it('colors the ring red when over budget', () => {
    expect(component.budgetRingColor()).toBe('var(--danger)');
  });
});
