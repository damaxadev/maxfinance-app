import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupActivityFullState } from '../../../core/group-activity-full-state/group-activity-full-state';
import { MovementsService } from '../../../core/movements/movements';
import { SettlementsService } from '../../../core/settlements/settlements';
import { GroupActivity } from './group-activity';

const fakeMembers = [
  { uid: 'u1', displayName: 'Diego', email: '', photoURL: '' },
  { uid: 'u2', displayName: 'Ana', email: '', photoURL: '' },
];
const fakeAccounts = [{ id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' }];
const fakeCategories = [{ id: 'cat1', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const }];

function ts(date: string) {
  return { toDate: () => new Date(date), toMillis: () => new Date(date).getTime() };
}

function sharedMovement(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'm-default',
    uid: 'u1',
    categoryId: 'cat1',
    type: 'expense',
    amount: 30,
    date: ts('2026-02-10'),
    note: '',
    groupId: 'group1',
    paidBy: 'u1',
    splitType: 'equal',
    splits: [],
    ...overrides,
  };
}

function settlement(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 's-default',
    groupId: 'group1',
    fromUid: 'u1',
    toUid: 'u2',
    amount: 20,
    date: ts('2026-02-12'),
    note: '',
    linkedMovementId: null,
    ...overrides,
  };
}

const movements = [sharedMovement({ id: 'm1', date: ts('2026-02-10') })];
const settlements = [settlement({ id: 's1', date: ts('2026-02-15') })];

describe('GroupActivity', () => {
  let component: GroupActivity;
  let fixture: ComponentFixture<GroupActivity>;
  let linkPersonalMovement: ReturnType<typeof vi.fn>;
  let findLinkedMovementSettlementIds: ReturnType<typeof vi.fn>;
  let countGroupMovements: ReturnType<typeof vi.fn>;
  let countGroupSettlements: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    linkPersonalMovement = vi.fn().mockResolvedValue(undefined);
    findLinkedMovementSettlementIds = vi.fn().mockResolvedValue(new Set());
    countGroupMovements = vi.fn().mockResolvedValue(1);
    countGroupSettlements = vi.fn().mockResolvedValue(1);

    await TestBed.configureTestingModule({
      imports: [GroupActivity],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: MovementsService, useValue: { groupMovements$: () => of(movements), countGroupMovements } },
        {
          provide: SettlementsService,
          useValue: { settlements$: () => of(settlements), linkPersonalMovement, findLinkedMovementSettlementIds, countGroupSettlements },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupActivity);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('combines movements and settlements sorted by date, newest first', () => {
    expect(component.entries().map((e) => e.id)).toEqual(['s1', 'm1']);
  });

  it('resolves a category label with icon + name, falling back for a deleted category', () => {
    expect(component.categoryLabel('cat1')).toBe('🍔 Comida');
    expect(component.categoryLabel('missing')).toBe('❓ Categoría eliminada');
  });

  it('shows "Registrar como gasto" when the current user is the payer (fromUid)', () => {
    expect(component.linkLabel(settlements[0] as never)).toBe('Registrar como gasto');
  });

  it('shows no link label for a group member who is not a party to the settlement', () => {
    expect(component.linkLabel(settlement({ id: 's2', fromUid: 'u2', toUid: 'u3' }) as never)).toBeNull();
  });

  it('checks which settlements already have a linked movement for the current user', () => {
    expect(findLinkedMovementSettlementIds).toHaveBeenCalledWith(['s1'], 'u1');
  });

  it('confirmLinking(): requires an account before saving', async () => {
    await component.confirmLinking(settlements[0] as never);

    expect(component.linkError()).toBe('Selecciona una cuenta.');
    expect(linkPersonalMovement).not.toHaveBeenCalled();
  });

  it('confirmLinking(): links the movement, marks it as linked, and closes the inline form', async () => {
    component.startLinking('s1');
    component.linkAccountId.set('acc1');

    await component.confirmLinking(settlements[0] as never);

    expect(linkPersonalMovement).toHaveBeenCalledWith(settlements[0], 'acc1');
    expect(component.alreadyLinked(settlements[0] as never)).toBe(true);
    expect(component.linkingSettlementId()).toBeNull();
  });

  it('confirmLinking(): shows an inline error if it fails', async () => {
    linkPersonalMovement.mockRejectedValue(new Error('boom'));
    component.linkAccountId.set('acc1');

    await component.confirmLinking(settlements[0] as never);

    expect(component.linkError()).toBe('No pudimos registrar el movimiento. Intenta de nuevo.');
  });

  it('cancelLinking() closes the inline form', () => {
    component.startLinking('s1');
    component.cancelLinking();

    expect(component.linkingSettlementId()).toBeNull();
  });

  it('loads the total count and exposes hasMore when there is more activity than the limit', async () => {
    countGroupMovements.mockResolvedValue(6);
    countGroupSettlements.mockResolvedValue(6);
    fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.componentInstance.totalCount()).toBe(12);
    expect(fixture.componentInstance.hasMore()).toBe(true);
  });

  it('openFullHistory() opens the GroupActivityFullState modal with the current group', () => {
    const state = TestBed.inject(GroupActivityFullState);
    component.openFullHistory();

    expect(state.groupId()).toBe('group1');
  });
});

describe('GroupActivity (viewed by the receiver, u2)', () => {
  it('shows "Registrar como ingreso" when the current user is the receiver (toUid)', async () => {
    await TestBed.configureTestingModule({
      imports: [GroupActivity],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u2' } } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: MovementsService, useValue: { groupMovements$: () => of([]), countGroupMovements: vi.fn().mockResolvedValue(0) } },
        {
          provide: SettlementsService,
          useValue: {
            settlements$: () => of(settlements),
            linkPersonalMovement: vi.fn(),
            findLinkedMovementSettlementIds: vi.fn().mockResolvedValue(new Set()),
            countGroupSettlements: vi.fn().mockResolvedValue(0),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();

    expect(fixture.componentInstance.linkLabel(settlements[0] as never)).toBe('Registrar como ingreso');
  });
});

describe('GroupActivity with limit=null (full history)', () => {
  let fixture: ComponentFixture<GroupActivity>;
  let countGroupMovements: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    countGroupMovements = vi.fn().mockResolvedValue(1);

    await TestBed.configureTestingModule({
      imports: [GroupActivity],
      providers: [
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: MovementsService, useValue: { groupMovements$: () => of([sharedMovement({ id: 'm1' })]), countGroupMovements } },
        {
          provide: SettlementsService,
          useValue: {
            settlements$: () => of([settlement({ id: 's1' })]),
            linkPersonalMovement: vi.fn(),
            findLinkedMovementSettlementIds: vi.fn().mockResolvedValue(new Set()),
            countGroupSettlements: vi.fn().mockResolvedValue(1),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupId', 'group1');
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.componentRef.setInput('limit', null);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('never fetches the total count and never shows "Ver todos"', () => {
    expect(countGroupMovements).not.toHaveBeenCalled();
    expect(fixture.componentInstance.hasMore()).toBe(false);
  });

  it('shows every entry with no slicing', () => {
    expect(fixture.componentInstance.entries().length).toBe(2);
  });
});
