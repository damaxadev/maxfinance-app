import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, type Observable } from 'rxjs';

import { AbonoDetailState } from '../../../core/abono-detail-state/abono-detail-state';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
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
  currentUid?: string;
}) {
  return TestBed.configureTestingModule({
    imports: [GroupActivity],
    providers: [
      { provide: Auth, useValue: { currentUser: { uid: opts.currentUid ?? 'u1' } } },
      { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      { provide: GroupsService, useValue: { groups$: of(opts.groups ?? fakeGroups) } },
      {
        provide: MovementsService,
        useValue: {
          allSharedMovementsForGroups$: opts.movements ?? (() => of(movements)),
        },
      },
      {
        provide: SettlementsService,
        useValue: {
          settlementsForGroups$: opts.settlements ?? (() => of(settlements)),
        },
      },
    ],
  }).compileComponents();
}

describe('GroupActivity', () => {
  let component: GroupActivity;
  let fixture: ComponentFixture<GroupActivity>;

  beforeEach(async () => {
    await configure({});

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

  it('combines movements and settlements, ordered newest first (fallback a `date`: ninguno de estos fixtures tiene createdAt)', () => {
    expect(component.entries().map((e) => e.id)).toEqual(['s1', 'm1']);
  });

  // TEST OBLIGATORIO — orden por createdAt (cuándo se registró), no por
  // `date` (lo que el usuario eligió) — ver DATABASE.md, "Balance de
  // grupo y abonos". Un gasto con `date` vieja pero registrado AHORA debe
  // ir primero; uno con `date` reciente pero registrado hace tiempo debe
  // quedar después.
  it('ordena por createdAt, no por date: un gasto con date vieja pero createdAt reciente va primero', async () => {
    TestBed.resetTestingModule();
    const oldButJustCreated = sharedMovement({
      id: 'm-old-date-new-created',
      date: ts('2020-01-01'),
      createdAt: ts('2026-06-01'),
    });
    const recentDateOldCreated = sharedMovement({
      id: 'm-recent-date-old-created',
      date: ts('2026-05-01'),
      createdAt: ts('2020-01-01'),
    });
    await configure({ movements: () => of([recentDateOldCreated, oldButJustCreated]), settlements: () => of([]) });

    const f = TestBed.createComponent(GroupActivity);
    f.componentRef.setInput('groupIds', ['group1']);
    f.componentRef.setInput('members', fakeMembers);
    f.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    expect(f.componentInstance.entries().map((e) => e.id)).toEqual(['m-old-date-new-created', 'm-recent-date-old-created']);
  });

  it('createdAt null (serverTimestamp pendiente) se trata como "ahora" — no se va al fondo', async () => {
    TestBed.resetTestingModule();
    const pending = sharedMovement({ id: 'm-pending', date: ts('2020-01-01'), createdAt: null });
    const old = sharedMovement({ id: 'm-old', date: ts('2026-01-01'), createdAt: ts('2026-01-01') });
    await configure({ movements: () => of([old, pending]), settlements: () => of([]) });

    const f = TestBed.createComponent(GroupActivity);
    f.componentRef.setInput('groupIds', ['group1']);
    f.componentRef.setInput('members', fakeMembers);
    f.detectChanges();
    await Promise.resolve();
    await Promise.resolve();

    expect(f.componentInstance.entries().map((e) => e.id)).toEqual(['m-pending', 'm-old']);
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

  // El desglose de allocations, el adjunto, anular, editar nota y
  // "Registrar como gasto/ingreso" viven ahora en AbonoDetail (ver su
  // propio spec) — esta fila solo abre ese detalle y muestra un resumen.
  it('openSettlementDetail(): opens AbonoDetailState with this settlement\'s groupId/id', () => {
    component.openSettlementDetail(settlements[0] as never);

    const state = TestBed.inject(AbonoDetailState);
    expect(state.context()).toEqual({ groupId: settlements[0].groupId, settlementId: settlements[0].id });
  });

  it('hasAttachment(): true only when attachmentPath is present', () => {
    expect(component.hasAttachment(settlement({ attachmentPath: 'settlements/s1/attachment' }) as never)).toBe(true);
    expect(component.hasAttachment(settlement({ attachmentPath: null }) as never)).toBe(false);
    expect(component.hasAttachment(settlements[0] as never)).toBe(false);
  });

  it('tapping a settlement row opens its detail, not an inline form', () => {
    const row = fixture.nativeElement.querySelectorAll('.mfx-group-activity__row')[0] as HTMLElement;
    row.click();

    const state = TestBed.inject(AbonoDetailState);
    expect(state.context()).toEqual({ groupId: settlements[0].groupId, settlementId: settlements[0].id });
  });
});

describe('GroupActivity with limit=null (full history — GroupDetail, sin "Ver todos")', () => {
  let fixture: ComponentFixture<GroupActivity>;

  beforeEach(async () => {
    await configure({
      movements: () => of([sharedMovement({ id: 'm1' })]),
      settlements: () => of([settlement({ id: 's1' })]),
    });

    fixture = TestBed.createComponent(GroupActivity);
    fixture.componentRef.setInput('groupIds', ['group1']);
    fixture.componentRef.setInput('members', fakeMembers);
    fixture.componentRef.setInput('limit', null);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('shows every entry with no slicing, no "Ver todos" button at all', () => {
    expect(fixture.componentInstance.entries().length).toBe(2);
    expect(fixture.nativeElement.querySelector('.mfx-section-add')).toBeNull();
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

  // El nuevo modelo calcula el estado de una cuota desde los abonos
  // (computeDebts), nunca desde installments[].status directo — ver
  // DATABASE.md, "Balance de grupo y abonos". Para que estos fixtures (que
  // marcan status: 'paid' a mano, como lo hacía el modelo viejo) sigan
  // representando un estado consistente, se sintetiza UN abono con
  // allocations que cubre exactamente cada cuota ya marcada 'paid' — así
  // ningún test de este describe tuvo que cambiar su fixture a mano.
  function syntheticSettlementsFor(movement: Record<string, unknown>): unknown[] {
    const installments = (movement['installments'] as { status: string; amount: number }[] | null | undefined) ?? [];
    const splits = (movement['splits'] as { uid: string }[] | undefined) ?? [];
    const debtorUid = splits.find((split) => split.uid !== movement['paidBy'])?.uid;
    const allocations = installments
      .map((installment, index) => ({ installment, index }))
      .filter(({ installment }) => installment.status === 'paid')
      .map(({ installment, index }) => ({
        movementId: movement['id'],
        debtorUid,
        installmentIndex: index,
        amount: installment.amount,
      }));
    if (!debtorUid || allocations.length === 0) {
      return [];
    }
    return [
      settlement({
        id: 's-synthetic',
        fromUid: debtorUid,
        toUid: movement['paidBy'],
        amount: allocations.reduce((sum, a) => sum + a.amount, 0),
        allocations,
        allocationMode: 'manual',
        // Antes que el gasto a propósito: entries() ordena descendente por
        // fecha, así que esto deja la fila del GASTO primera en el DOM —
        // los querySelector(...) de abajo (chevron, fecha, etc.) siguen
        // encontrando los elementos del gasto, no los de este abono.
        date: ts('2020-01-01'),
      }),
    ];
  }

  async function setUp(movement: Record<string, unknown>, currentUid = 'u1') {
    await configure({ movements: () => of([movement]), settlements: () => of(syntheticSettlementsFor(movement)), currentUid });
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

  it('payInstallment(): opens SettlementFormState with the debtor/payer and the "installment" preselect', async () => {
    const fixture = await setUp(movementWithInstallments);
    const state = TestBed.inject(SettlementFormState);

    fixture.componentInstance.payInstallment(movementWithInstallments as never, installmentPlan[0] as never, 0);

    expect(state.context()).toEqual({
      groupId: 'group1',
      fromUid: 'u2',
      toUid: 'u1',
      fromName: 'Ana',
      toName: 'Diego',
      preselect: { mode: 'installment', movementId: 'm1', installmentIndex: 0 },
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
