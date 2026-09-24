import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupActivityFullState } from '../../../core/group-activity-full-state/group-activity-full-state';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { SettlementsService } from '../../../core/settlements/settlements';
import { GroupActivity } from './group-activity';

const fakeMembers = [
  { uid: 'u1', displayName: 'Diego', email: '', photoURL: '' },
  { uid: 'u2', displayName: 'Ana', email: '', photoURL: '' },
];
const fakeAccounts = [{ id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' }];
const fakeCategories = [{ id: 'cat1', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const }];
const fakeGroups = [
  { id: 'group1', name: 'Apartamento', members: ['u1', 'u2'], createdBy: 'u1', createdAt: {} as never },
  { id: 'group2', name: 'Viaje', members: ['u1', 'u2'], createdBy: 'u1', createdAt: {} as never },
];

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

function configure(opts: {
  groups?: unknown[];
  movements?: () => Observable<unknown[]>;
  settlements?: () => Observable<unknown[]>;
  linkPersonalMovement?: ReturnType<typeof vi.fn>;
  findLinkedMovementSettlementIds?: ReturnType<typeof vi.fn>;
  countGroupMovements?: ReturnType<typeof vi.fn>;
  countGroupSettlements?: ReturnType<typeof vi.fn>;
  currentUid?: string;
}) {
  return TestBed.configureTestingModule({
    imports: [GroupActivity],
    providers: [
      { provide: Auth, useValue: { currentUser: { uid: opts.currentUid ?? 'u1' } } },
      { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
      { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      { provide: GroupsService, useValue: { groups$: of(opts.groups ?? fakeGroups) } },
      {
        provide: MovementsService,
        useValue: {
          allSharedMovementsForGroups$: opts.movements ?? (() => of(movements)),
          countGroupMovements: opts.countGroupMovements ?? vi.fn().mockResolvedValue(1),
        },
      },
      {
        provide: SettlementsService,
        useValue: {
          settlementsForGroups$: opts.settlements ?? (() => of(settlements)),
          linkPersonalMovement: opts.linkPersonalMovement ?? vi.fn().mockResolvedValue(undefined),
          findLinkedMovementSettlementIds: opts.findLinkedMovementSettlementIds ?? vi.fn().mockResolvedValue(new Set()),
          countGroupSettlements: opts.countGroupSettlements ?? vi.fn().mockResolvedValue(1),
        },
      },
    ],
  }).compileComponents();
}

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

    await configure({ linkPersonalMovement, findLinkedMovementSettlementIds, countGroupMovements, countGroupSettlements });

    fixture = TestBed.createComponent(GroupActivity);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('groupIds', ['group1']);
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

  it('does not show the group tag for a single group', () => {
    expect(component.showGroupTag()).toBe(false);
    expect(fixture.nativeElement.querySelector('.mfx-group-activity__date').textContent).not.toContain('Apartamento');
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

  it('loads the total count (summed across groupIds) and exposes hasMore when there is more activity than the limit', async () => {
    countGroupMovements.mockResolvedValue(6);
    countGroupSettlements.mockResolvedValue(6);
    fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupIds', ['group1']);
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.componentInstance.totalCount()).toBe(12);
    expect(fixture.componentInstance.hasMore()).toBe(true);
  });

  it('openFullHistory() opens the GroupActivityFullState modal with the current (single) group', () => {
    const state = TestBed.inject(GroupActivityFullState);
    component.openFullHistory();

    expect(state.groupId()).toBe('group1');
  });
});

describe('GroupActivity (viewed by the receiver, u2)', () => {
  it('shows "Registrar como ingreso" when the current user is the receiver (toUid)', async () => {
    await configure({ movements: () => of([]), currentUid: 'u2' });
    const fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupIds', ['group1']);
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

    await configure({
      movements: () => of([sharedMovement({ id: 'm1' })]),
      settlements: () => of([settlement({ id: 's1' })]),
      countGroupMovements,
    });

    fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupIds', ['group1']);
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

describe('GroupActivity with multiple groupIds (e.g. Inicio, "Gastos compartidos recientes")', () => {
  let component: GroupActivity;
  let fixture: ComponentFixture<GroupActivity>;

  beforeEach(async () => {
    await configure({
      movements: () => of([sharedMovement({ id: 'm-g1', groupId: 'group1', date: ts('2026-02-10') })]),
      settlements: () => of([settlement({ id: 's-g2', groupId: 'group2', date: ts('2026-02-15') })]),
    });

    fixture = TestBed.createComponent(GroupActivity);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('groupIds', ['group1', 'group2']);
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  });

  it('combines entries from every group, sorted by date descending', () => {
    expect(component.entries().map((e) => e.id)).toEqual(['s-g2', 'm-g1']);
  });

  it('shows the origin group name as a tag on each entry', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Apartamento');
    expect(text).toContain('Viaje');
  });

  it('never shows "Ver todos" — GroupActivityFullState is single-group scoped', () => {
    expect(component.hasMore()).toBe(false);
  });

  it('openFullHistory() is a no-op with more than one group', () => {
    const state = TestBed.inject(GroupActivityFullState);
    component.openFullHistory();

    expect(state.groupId()).toBeNull();
  });

  it('shows a multi-group empty state when there is no activity at all', async () => {
    TestBed.resetTestingModule();
    await configure({ movements: () => of([]), settlements: () => of([]) });
    const emptyFixture = TestBed.createComponent(GroupActivity);
    emptyFixture.componentRef.setInput('groupIds', ['group1', 'group2']);
    emptyFixture.componentRef.setInput('members', fakeMembers);
    emptyFixture.detectChanges();

    expect(emptyFixture.nativeElement.textContent).toContain('Todavía no tienes gastos compartidos recientes.');
  });
});
