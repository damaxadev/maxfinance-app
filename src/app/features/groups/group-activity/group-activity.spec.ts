import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupActivityFullState } from '../../../core/group-activity-full-state/group-activity-full-state';
import { GroupDetailState } from '../../../core/group-detail-state/group-detail-state';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { SettlementFormState } from '../../../core/settlement-form-state/settlement-form-state';
import { SettlementsService } from '../../../core/settlements/settlements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
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

  it('resolves a category label via the live join when categoryName is absent (legacy movements)', () => {
    expect(component.categoryLabel(sharedMovement({ categoryId: 'cat1' }) as never)).toBe('🍔 Comida');
    expect(component.categoryLabel(sharedMovement({ categoryId: 'missing' }) as never)).toBe('❓ Categoría eliminada');
  });

  it('prefers the denormalized categoryName/categoryIcon over the live join', () => {
    // cat1 belongs to u1 (Comida) — simulate a custom category of ANOTHER
    // member that the current viewer can't resolve via the live join at
    // all (not in fakeCategories), proving it reads the saved snapshot.
    const movement = sharedMovement({ categoryId: 'cat-of-u2', categoryName: 'Mascotas', categoryIcon: '🐶' });
    expect(component.categoryLabel(movement as never)).toBe('🐶 Mascotas');
  });

  it('shows "Sin categoría" when categoryId is null', () => {
    const movement = sharedMovement({ categoryId: null, categoryName: null, categoryIcon: null });
    expect(component.categoryLabel(movement as never)).toBe('🗂️ Sin categoría');
  });

  it('falls back to "Categoría eliminada" when the denormalized category was deleted since', () => {
    const movement = sharedMovement({ categoryId: 'cat-of-u2', categoryName: null, categoryIcon: null });
    expect(component.categoryLabel(movement as never)).toBe('❓ Categoría eliminada');
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

// Fase 10 (ajuste posterior): el guard de permisos/bloqueo se movió adentro
// del modal (SharedExpenseForm.readOnly()/isLocked(), ver ese spec) — acá
// solo queda confirmar que CUALQUIER gasto es tappable y siempre abre el
// modal, sin importar quién lo registró ("nunca no pasa nada al tocar").
describe('GroupActivity — abrir el modal de un gasto compartido (Fase 10)', () => {
  async function setUp(movement: Record<string, unknown>) {
    await configure({ movements: () => of([movement]), settlements: () => of([]) });
    const fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupIds', ['group1']);
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    return fixture;
  }

  it('openMovement(): opens the shared-expense modal for a movement registered by the current user', async () => {
    const movement = sharedMovement({ id: 'm1', uid: 'u1', paidBy: 'u1' });
    const fixture = await setUp(movement);
    const state = TestBed.inject(SharedExpenseFormState);

    fixture.componentInstance.openMovement(movement as never);

    expect(state.request()).toEqual({ mode: 'edit', movement });
  });

  it('openMovement(): also opens it for a movement registered by someone else (read-only is the modal\'s job)', async () => {
    const movement = sharedMovement({ id: 'm1', uid: 'u2', paidBy: 'u2' });
    const fixture = await setUp(movement);
    const state = TestBed.inject(SharedExpenseFormState);

    fixture.componentInstance.openMovement(movement as never);

    expect(state.request()).toEqual({ mode: 'edit', movement });
  });

  it('marks every movement row as clickable, regardless of who registered it', async () => {
    const fixture = await setUp(sharedMovement({ id: 'm1', uid: 'u2', paidBy: 'u2' }));

    const row = fixture.nativeElement.querySelector('.mfx-group-activity__row');
    expect(row.classList.contains('mfx-group-activity__row--clickable')).toBe(true);
  });
});

// linkToGroupDetail: false por defecto (GroupDetail, uso de arriba — tocar
// una fila edita el gasto, sin cambios) vs. true (Inicio, "Gastos
// compartidos recientes" — tocar una fila abre el grupo en vez de editar).
describe('GroupActivity — linkToGroupDetail (Inicio abre el grupo, GroupDetail edita el gasto)', () => {
  async function setUp(movement: Record<string, unknown>, linkToGroupDetail: boolean) {
    await configure({ movements: () => of([movement]), settlements: () => of([]) });
    const fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupIds', ['group1']);
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.componentRef.setInput('linkToGroupDetail', linkToGroupDetail);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    return fixture;
  }

  it('default (false): tapping a row opens the shared-expense edit modal, same as always', async () => {
    const movement = sharedMovement({ id: 'm1' });
    const fixture = await setUp(movement, false);
    const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);
    const groupDetailState = TestBed.inject(GroupDetailState);

    fixture.nativeElement.querySelector('.mfx-group-activity__row').click();

    expect(sharedExpenseFormState.request()).toEqual({ mode: 'edit', movement });
    expect(groupDetailState.groupId()).toBeNull();
  });

  it('true (Inicio): tapping a row opens the group\'s detail instead of the edit modal', async () => {
    const movement = sharedMovement({ id: 'm1', groupId: 'group1' });
    const fixture = await setUp(movement, true);
    const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);
    const groupDetailState = TestBed.inject(GroupDetailState);

    fixture.nativeElement.querySelector('.mfx-group-activity__row').click();

    expect(groupDetailState.groupId()).toBe('group1');
    expect(sharedExpenseFormState.request()).toBeNull();
  });
});

// Fase 10+1: desglose de cuotas por gasto + "marcar como pagada" (ver
// DATABASE.md, "Pagos a cuotas") — reusa el mismo SettlementForm que saldar
// una deuda completa, con installmentRef en el contexto.
describe('GroupActivity — cuotas (Fase 10+1)', () => {
  const installmentPlan = [
    { dueDate: ts('2026-02-10'), amount: 25, status: 'pending' as const },
    { dueDate: ts('2026-03-10'), amount: 25, status: 'paid' as const },
  ];
  const movementWithInstallments = sharedMovement({
    id: 'm1',
    paidBy: 'u1',
    splits: [
      { uid: 'u1', amount: 25, settled: true },
      { uid: 'u2', amount: 25, settled: false },
    ],
    installments: installmentPlan,
  });

  async function setUp(movement: Record<string, unknown>, currentUid = 'u1') {
    await configure({ movements: () => of([movement]), settlements: () => of([]), currentUid });
    const fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupIds', ['group1']);
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
    return fixture;
  }

  it('shows both cuotas inline, expanded by default', async () => {
    const fixture = await setUp(movementWithInstallments);

    const rows = fixture.nativeElement.querySelectorAll('mfx-installment-row');
    expect(rows.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('✓ Pagada');
  });

  it('canPayInstallment(): true for the payer', async () => {
    const fixture = await setUp(movementWithInstallments, 'u1');
    expect(fixture.componentInstance.canPayInstallment(movementWithInstallments as never)).toBe(true);
  });

  it('canPayInstallment(): true for the debtor', async () => {
    TestBed.resetTestingModule();
    const fixture = await setUp(movementWithInstallments, 'u2');
    expect(fixture.componentInstance.canPayInstallment(movementWithInstallments as never)).toBe(true);
  });

  it('canPayInstallment(): false for someone outside the debt', async () => {
    TestBed.resetTestingModule();
    const fixture = await setUp(movementWithInstallments, 'u3');
    expect(fixture.componentInstance.canPayInstallment(movementWithInstallments as never)).toBe(false);
  });

  it('shows "Marcar como pagada" only for the pending cuota, not the paid one', async () => {
    const fixture = await setUp(movementWithInstallments);

    const buttons = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('mfx-installment-row button')
    );
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent?.trim()).toBe('Marcar como pagada');
  });

  // El botón detiene la propagación en el propio componente InstallmentRow
  // (no en un contenedor de GroupActivity) — tocarlo nunca debe ABRIR
  // también el modal de edición de la fila.
  it('clicking "Marcar como pagada" does not also open the edit modal', async () => {
    const fixture = await setUp(movementWithInstallments);
    const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('mfx-installment-row button');
    button.click();

    expect(sharedExpenseFormState.request()).toBeNull();
  });

  it('tapping anywhere else in the row (e.g. the cuotas area text) still opens the edit modal', async () => {
    const fixture = await setUp(movementWithInstallments);
    const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);

    const installmentsBlock: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__installments');
    installmentsBlock.click();

    expect(sharedExpenseFormState.request()).toEqual({ mode: 'edit', movement: movementWithInstallments });
  });

  // Resumen "X de Y cuotas pagadas": único control de colapso, con su
  // propio stopPropagation acotado a sí mismo — mismo patrón que el botón
  // "Marcar como pagada" de InstallmentRow (ver ese spec). Arranca
  // expandido por defecto.
  describe('resumen "X de Y cuotas pagadas" (colapsa/expande el bloque)', () => {
    it('muestra cuántas cuotas están pagadas sobre el total', async () => {
      const fixture = await setUp(movementWithInstallments); // 1 pagada de 2

      const toggle: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__installments-toggle');
      expect(toggle.textContent?.trim()).toContain('1 de 2 cuotas pagadas');
    });

    it('arranca expandido: el bloque de cuotas es visible desde el inicio', async () => {
      const fixture = await setUp(movementWithInstallments);

      expect(fixture.componentInstance.isInstallmentsExpanded('m1')).toBe(true);
      expect(fixture.nativeElement.querySelector('.mfx-group-activity__installments')).toBeTruthy();
    });

    // collapsedByDefault (Inicio, ver home.html) invierte el default — sin
    // tocarlo para nada el resto de este describe (GroupDetail no lo pasa).
    it('con [collapsedByDefault]="true" arranca COLAPSADO en vez de expandido', async () => {
      await configure({ movements: () => of([movementWithInstallments]), settlements: () => of([]) });
      const fixture = TestBed.createComponent(GroupActivity);
      fixture.componentRef.setInput('groupIds', ['group1']);
      fixture.componentRef.setInput('members', fakeMembers);
      fixture.componentRef.setInput('collapsedByDefault', true);
      fixture.detectChanges();
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();

      expect(fixture.componentInstance.isInstallmentsExpanded('m1')).toBe(false);
      expect(fixture.nativeElement.querySelector('.mfx-group-activity__installments')).toBeNull();

      const toggle: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__installments-toggle');
      toggle.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.isInstallmentsExpanded('m1')).toBe(true);
      expect(fixture.nativeElement.querySelectorAll('mfx-installment-row').length).toBe(2);
    });

    it('tocar el resumen colapsa el bloque: oculta las filas de cuota', async () => {
      const fixture = await setUp(movementWithInstallments);

      const toggle: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__installments-toggle');
      toggle.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.isInstallmentsExpanded('m1')).toBe(false);
      expect(fixture.nativeElement.querySelector('.mfx-group-activity__installments')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('mfx-installment-row').length).toBe(0);
    });

    it('tocarlo de nuevo vuelve a expandir', async () => {
      const fixture = await setUp(movementWithInstallments);
      const toggle: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__installments-toggle');

      toggle.click();
      fixture.detectChanges();
      toggle.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.isInstallmentsExpanded('m1')).toBe(true);
      expect(fixture.nativeElement.querySelectorAll('mfx-installment-row').length).toBe(2);
    });

    it('el chevron rota (clase --expanded) según el estado', async () => {
      const fixture = await setUp(movementWithInstallments);
      const chevronSelector = '.mfx-group-activity__installments-chevron';
      const expandedClass = 'mfx-group-activity__installments-chevron--expanded';

      expect(fixture.nativeElement.querySelector(chevronSelector).classList.contains(expandedClass)).toBe(true);

      const toggle: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__installments-toggle');
      toggle.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector(chevronSelector).classList.contains(expandedClass)).toBe(false);
    });

    // El mismo bug que ya corrigimos con el toggle anterior ("Cuotas: X de
    // Y pendientes"): un control de colapso dentro de la fila NUNCA puede
    // tragarse taps destinados a abrir el modal, ni al revés.
    it('tocar el resumen/chevron NUNCA abre el modal de edición', async () => {
      const fixture = await setUp(movementWithInstallments);
      const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);

      const toggle: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__installments-toggle');
      toggle.click();

      expect(sharedExpenseFormState.request()).toBeNull();
    });

    it('tocar cualquier otra parte de la fila (incluso cerca del resumen, p. ej. la fecha) sigue abriendo el modal', async () => {
      const fixture = await setUp(movementWithInstallments);
      const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);

      const dateSpan: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__date');
      dateSpan.click();

      expect(sharedExpenseFormState.request()).toEqual({ mode: 'edit', movement: movementWithInstallments });
    });
  });

  it('payInstallment(): opens SettlementFormState with the debtor/payer and the installmentRef', async () => {
    const fixture = await setUp(movementWithInstallments);
    const state = TestBed.inject(SettlementFormState);

    fixture.componentInstance.payInstallment(movementWithInstallments as never, installmentPlan[0] as never, 0);

    expect(state.context()).toEqual({
      groupId: 'group1',
      fromUid: 'u2',
      toUid: 'u1',
      amount: 25,
      fromName: 'Ana',
      toName: 'Diego',
      installmentRef: { movementId: 'm1', installmentIndex: 0, totalInstallments: 2 },
    });
  });

  it('a movement with no installments shows no cuotas block at all', async () => {
    const fixture = await setUp(sharedMovement({ id: 'm1', installments: null }));

    expect(fixture.nativeElement.querySelector('.mfx-group-activity__installments')).toBeNull();
  });

  // Más de MAX_VISIBLE_INSTALLMENTS (3): se prioriza la próxima pendiente y
  // las más cercanas, no siempre las primeras — y el resto se resume en
  // texto plano, nunca un botón/toggle (ver el bug de filas no tappables).
  describe('con más de 3 cuotas', () => {
    const sixInstallments = [
      { dueDate: ts('2026-01-01'), amount: 10, status: 'paid' as const },
      { dueDate: ts('2026-02-01'), amount: 10, status: 'paid' as const },
      { dueDate: ts('2026-03-01'), amount: 10, status: 'pending' as const },
      { dueDate: ts('2026-04-01'), amount: 10, status: 'pending' as const },
      { dueDate: ts('2026-05-01'), amount: 10, status: 'pending' as const },
      { dueDate: ts('2026-06-01'), amount: 10, status: 'pending' as const },
    ];
    const movementWithSix = sharedMovement({
      id: 'm1',
      paidBy: 'u1',
      splits: [{ uid: 'u1', amount: 30, settled: true }, { uid: 'u2', amount: 30, settled: false }],
      installments: sixInstallments,
    });

    it('visibleInstallments(): shows a window of 3 starting at the next pending cuota, not the first 3', async () => {
      const fixture = await setUp(movementWithSix);

      const indexes = fixture.componentInstance.visibleInstallments(movementWithSix as never).map((e) => e.index);
      expect(indexes).toEqual([2, 3, 4]); // cuota 3 (primera pendiente) a la 5, no la 1-2-3
    });

    it('remainingInstallmentsCount(): counts what is left out of the visible window', async () => {
      const fixture = await setUp(movementWithSix);

      expect(fixture.componentInstance.remainingInstallmentsCount(movementWithSix as never)).toBe(3); // 6 - 3
    });

    it('shows the "+N cuotas más" plain text, not a button', async () => {
      const fixture = await setUp(movementWithSix);

      const moreText = fixture.nativeElement.querySelector('.mfx-group-activity__more-installments');
      expect(moreText.tagName.toLowerCase()).not.toBe('button');
      expect(moreText.textContent?.trim()).toBe('+3 cuotas más');
    });

    it('tapping the "+N cuotas más" text still opens the edit modal (no excepciones)', async () => {
      const fixture = await setUp(movementWithSix);
      const sharedExpenseFormState = TestBed.inject(SharedExpenseFormState);

      const moreText: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__more-installments');
      moreText.click();

      expect(sharedExpenseFormState.request()).toEqual({ mode: 'edit', movement: movementWithSix });
    });

    it('colapsar el resumen también oculta el texto "+N cuotas más"', async () => {
      const fixture = await setUp(movementWithSix);

      const toggle: HTMLElement = fixture.nativeElement.querySelector('.mfx-group-activity__installments-toggle');
      toggle.click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.mfx-group-activity__more-installments')).toBeNull();
    });

    it('shows all of them, with no "+N más" text, when there are 3 or fewer (falls within the window)', async () => {
      const fixture = await setUp(movementWithInstallments); // solo 2 cuotas

      expect(fixture.componentInstance.remainingInstallmentsCount(movementWithInstallments as never)).toBe(0);
      expect(fixture.nativeElement.querySelector('.mfx-group-activity__more-installments')).toBeNull();
    });

    it('falls back to the first 3 when every installment is already paid', async () => {
      const allPaid = sharedMovement({
        id: 'm1',
        paidBy: 'u1',
        splits: [{ uid: 'u1', amount: 30, settled: true }, { uid: 'u2', amount: 30, settled: false }],
        installments: sixInstallments.map((i) => ({ ...i, status: 'paid' as const })),
      });
      const fixture = await setUp(allPaid);

      const indexes = fixture.componentInstance.visibleInstallments(allPaid as never).map((e) => e.index);
      expect(indexes).toEqual([0, 1, 2]);
    });
  });
});
