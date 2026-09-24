import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Movements } from './movements';
import { Accounts } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { MovementFormState } from '../../../core/movement-form-state/movement-form-state';
import { AccountFormState } from '../../../core/account-form-state/account-form-state';

const fakeAccounts = [
  { id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 100, currency: 'COP' },
  { id: 'acc2', uid: 'u1', name: 'Banco', type: 'banco' as const, balance: 200, currency: 'COP' },
];
const fakeCategories = [
  { id: 'cat1', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const },
  { id: 'cat2', uid: null, name: 'Salario', icon: '💼', type: 'income' as const },
];
const fakeGroups = [{ id: 'group1', name: 'Nuevo grupo', members: ['u1', 'u2'], createdBy: 'u1', createdAt: {} as never }];

function ts(date: string) {
  return { toDate: () => new Date(date), toMillis: () => new Date(date).getTime() };
}

function movement(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'mov-default',
    uid: 'u1',
    accountId: 'acc1',
    categoryId: 'cat1',
    type: 'expense',
    amount: 50,
    date: ts('2026-02-15'),
    note: '',
    groupId: null,
    ...overrides,
  };
}
const fakeMovements = [
  movement({ id: 'mov1', accountId: 'acc1', categoryId: 'cat1', date: ts('2026-02-10') }),
  movement({ id: 'mov2', accountId: 'acc2', categoryId: 'cat2', type: 'income', date: ts('2026-02-20') }),
];

function sharedMovement(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'shared-default',
    uid: 'u1',
    categoryId: 'cat1',
    type: 'expense',
    amount: 30,
    date: ts('2026-02-15'),
    note: '',
    groupId: 'group1',
    paidBy: 'u1',
    splitType: 'equal',
    splits: [],
    accountId: 'acc1',
    ...overrides,
  };
}

describe('Movements', () => {
  let component: Movements;
  let fixture: ComponentFixture<Movements>;
  let sharedMovementsForGroups: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sharedMovementsForGroups = vi.fn(() => of([]));

    await TestBed.configureTestingModule({
      imports: [Movements],
      providers: [
        provideNoopAnimations(),
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { groups$: of([]) } },
        { provide: MovementsService, useValue: { personalMovements$: of(fakeMovements), sharedMovementsForGroups$: sharedMovementsForGroups } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Movements);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows all movements when there is no filter, newest first', () => {
    expect(component.filteredMovements().map((m) => m.id)).toEqual(['mov2', 'mov1']);
  });

  it('filters by account', () => {
    component.filterAccountId.set('acc2');
    expect(component.filteredMovements().map((m) => m.id)).toEqual(['mov2']);
  });

  it('filters by category', () => {
    component.filterCategoryId.set('cat2');
    expect(component.filteredMovements().map((m) => m.id)).toEqual(['mov2']);
  });

  it('filters by date range', () => {
    component.filterFrom.set('2026-02-15');
    expect(component.filteredMovements().map((m) => m.id)).toEqual(['mov2']);

    component.filterFrom.set('');
    component.filterTo.set('2026-02-15');
    expect(component.filteredMovements().map((m) => m.id)).toEqual(['mov1']);
  });

  it('resolves account and category display names', () => {
    expect(component.accountName('acc1')).toBe('Efectivo');
    expect(component.categoryName('cat1')).toBe('Comida');
    expect(component.categoryIcon('cat1')).toBe('🍔');
  });

  it('falls back gracefully for a deleted account/category reference', () => {
    expect(component.accountName('missing')).toBe('Cuenta eliminada');
    expect(component.categoryName('missing')).toBe('Categoría eliminada');
  });

  it('delegates opening the account modal in create mode to the shared AccountFormState', () => {
    const state = TestBed.inject(AccountFormState);
    component.openCreateAccount();
    expect(state.request()).toEqual({ mode: 'create' });
  });

  it('delegates opening the account modal in edit mode to the shared AccountFormState', () => {
    const state = TestBed.inject(AccountFormState);
    component.openEditAccount(fakeAccounts[0]);
    expect(state.request()).toEqual({ mode: 'edit', account: fakeAccounts[0] });
  });

  it('delegates editing a personal movement to the shared MovementFormState', () => {
    const state = TestBed.inject(MovementFormState);
    const item = component.filteredMovements().find((m) => m.id === 'mov1')!;
    component.editMovement(item);

    expect(state.request()).toEqual({ mode: 'edit', movement: fakeMovements[0] });
  });
});

describe('Movements with shared expenses', () => {
  let component: Movements;
  let fixture: ComponentFixture<Movements>;

  beforeEach(async () => {
    const shared = [sharedMovement({ id: 'shared1', date: ts('2026-02-25') })];

    await TestBed.configureTestingModule({
      imports: [Movements],
      providers: [
        provideNoopAnimations(),
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { groups$: of(fakeGroups) } },
        {
          provide: MovementsService,
          useValue: { personalMovements$: of(fakeMovements), sharedMovementsForGroups$: () => of(shared) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Movements);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('merges shared expenses with personal movements, sorted by date (newest first)', () => {
    expect(component.filteredMovements().map((m) => m.id)).toEqual(['shared1', 'mov2', 'mov1']);
  });

  it('labels a shared expense with its group name instead of an account', () => {
    const item = component.filteredMovements().find((m) => m.id === 'shared1')!;
    expect(item.groupName).toBe('Nuevo grupo');
    expect(item.kind).toBe('shared');
  });

  it('does not open the edit form for a shared expense (no personal movement to edit)', () => {
    const state = TestBed.inject(MovementFormState);
    const item = component.filteredMovements().find((m) => m.id === 'shared1')!;
    component.editMovement(item);

    expect(state.request()).toBeNull();
  });
});
