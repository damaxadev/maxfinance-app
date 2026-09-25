import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { SharedExpenseFormState } from '../../../core/shared-expense-form-state/shared-expense-form-state';
import { SharedExpenseForm } from './shared-expense-form';

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

const fakeAccounts = [{ id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' }];
const fakeCategories = [
  { id: 'cat-expense', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const },
  { id: 'cat-income', uid: null, name: 'Salario', icon: '💼', type: 'income' as const },
];
const fakeMembers = [
  { uid: 'u1', displayName: 'Diego', email: 'diego@example.com', photoURL: '' },
  { uid: 'u2', displayName: 'Ana', email: 'ana@example.com', photoURL: '' },
];
const fakeSharedGroup = {
  id: 'group1',
  name: 'Apartamento',
  members: ['u1', 'u2'],
  createdBy: 'u1',
  createdAt: {} as never,
  type: 'shared' as const,
};

describe('SharedExpenseForm', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;
  let createShared: ReturnType<typeof vi.fn>;
  let getMemberProfiles: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createShared = vi.fn().mockResolvedValue(undefined);
    getMemberProfiles = vi.fn().mockResolvedValue(fakeMembers);

    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { createShared } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles, groups$: of([fakeSharedGroup]) } },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    TestBed.inject(ActiveGroup).select('group1');
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('submits with the current time of day, not midnight, when the date is left unchanged', async () => {
    // El campo date ya trae "hoy" por defecto desde la construcción (antes
    // de fijar el reloj falso) — se deriva el año/mes/día esperado de ese
    // mismo valor en vez de asumir uno fijo, para no acoplar el test al
    // momento real en que corre.
    const [year, month, day] = component.form.controls.date.value.split('-').map(Number);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(year, month - 1, day, 14, 30, 15));
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();
    vi.useRealTimers();

    const [value] = createShared.mock.calls[0];
    expect(value.date.getFullYear()).toBe(year);
    expect(value.date.getMonth()).toBe(month - 1);
    expect(value.date.getDate()).toBe(day);
    expect(value.date.getHours()).toBe(14);
    expect(value.date.getMinutes()).toBe(30);
    expect(value.date.getSeconds()).toBe(15);
  });

  it('keeps the current time of day even when the date is changed to a past date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 9, 5, 0));
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');
    component.form.controls.date.setValue('2026-03-01');

    await component.submit();
    vi.useRealTimers();

    const [value] = createShared.mock.calls[0];
    expect(value.date.getDate()).toBe(1);
    expect(value.date.getHours()).toBe(9);
    expect(value.date.getMinutes()).toBe(5);
  });

  it('loads the members of the active group and defaults paidBy to the current user', () => {
    expect(getMemberProfiles).toHaveBeenCalledWith('group1');
    expect(component.members()).toEqual(fakeMembers);
    expect(component.form.controls.paidBy.value).toBe('u1');
  });

  it('needsAccount() is true when the current user is the payer', () => {
    expect(component.needsAccount()).toBe(true);
  });

  it('needsAccount() is false and clears accountId when someone else is selected as payer', () => {
    component.selectPaidBy('u2');
    fixture.detectChanges();

    expect(component.needsAccount()).toBe(false);
    expect(component.form.controls.accountId.value).toBe('');
    expect(component.form.controls.accountId.hasError('required')).toBe(false);
  });

  it('requires an account when the payer is the current user', () => {
    expect(component.form.controls.accountId.hasError('required')).toBe(true);
  });

  it('distributes an equal split with the exact total (remainder goes to the first member)', () => {
    component.form.controls.amount.setValue(100);
    fixture.detectChanges();

    // 100 / 2 miembros = 50 c/u, exacto, sin residuo.
    expect(component.equalSplitPreview()).toEqual([
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ]);
  });

  it('handles an uneven equal split without losing a cent', () => {
    // 100 entre 3 no divide exacto -> el residuo se lo lleva el primero.
    getMemberProfiles.mockResolvedValue([...fakeMembers, { uid: 'u3', displayName: 'Beto', email: '', photoURL: '' }]);
    component.form.controls.amount.setValue(100);

    const splits = component.equalSplitPreview();
    const total = splits.reduce((sum, s) => sum + s.amount, 0);

    expect(total).toBe(100);
  });

  it('rebuilds split inputs (one per member) when switching to percentage', () => {
    component.selectSplitType('percentage');
    fixture.detectChanges();

    expect(component.splitInputs.length).toBe(2);
    expect(component.splitInputs.at(0).controls.value.value).toBe(50);
    expect(component.splitMismatch()).toBe(false);
  });

  it('flags a mismatch when percentages do not sum to 100', () => {
    component.selectSplitType('percentage');
    fixture.detectChanges();
    component.splitInputs.at(0).controls.value.setValue(20);

    expect(component.splitMismatch()).toBe(true);
  });

  it('flags a mismatch when fixed amounts do not sum to the total', () => {
    component.form.controls.amount.setValue(100);
    component.selectSplitType('fixed');
    fixture.detectChanges();
    component.splitInputs.at(0).controls.value.setValue(10);

    expect(component.splitMismatch()).toBe(true);
  });

  it('blocks submit while there is a split mismatch, without calling the service', async () => {
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');
    component.selectSplitType('percentage');
    fixture.detectChanges();
    component.splitInputs.at(0).controls.value.setValue(20);

    await component.submit();

    expect(createShared).not.toHaveBeenCalled();
  });

  it('submits an equal split with the correct payload', async () => {
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group1',
        paidBy: 'u1',
        amount: 100,
        accountId: 'acc1',
        categoryId: 'cat-expense',
        splitType: 'equal',
        splits: [
          { uid: 'u1', amount: 50, settled: false },
          { uid: 'u2', amount: 50, settled: false },
        ],
      })
    );
    expect(emitted.length).toBe(1);
  });

  it('submits a percentage split converted to actual amounts', async () => {
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');
    component.selectSplitType('percentage');
    fixture.detectChanges();
    component.splitInputs.at(0).controls.value.setValue(70);
    component.splitInputs.at(1).controls.value.setValue(30);

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(
      expect.objectContaining({
        splitType: 'percentage',
        splits: [
          { uid: 'u1', amount: 70, settled: false },
          { uid: 'u2', amount: 30, settled: false },
        ],
      })
    );
  });

  it('sends accountId: null when the payer is someone else', async () => {
    component.selectPaidBy('u2');
    fixture.detectChanges();
    component.form.controls.amount.setValue(100);
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(expect.objectContaining({ paidBy: 'u2', accountId: null }));
  });

  it('shows an inline error if createShared() fails', async () => {
    createShared.mockRejectedValue(new Error('boom'));
    component.form.controls.amount.setValue(100);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(component.errorMessage()).toBe('No pudimos guardar el gasto. Intenta de nuevo.');
  });

  it('disables the submit button while the form is invalid', () => {
    component.form.controls.categoryId.setValue('');
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
    expect(button.disabled).toBe(true);
  });

  // Fase 9 (adaptación de copy/UI para grupos de un solo miembro): con 2+
  // miembros nada cambia — cobertura explícita para no regresarlo.
  it('is not the personal flow with 2+ members — both sections render, button says "compartido"', () => {
    expect(component.isPersonalFlow()).toBe(false);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('¿Quién pagó?');
    expect(text).toContain('División');

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
    expect(button.textContent?.trim()).toBe('Agregar gasto compartido');
  });

  it('publishes isPersonalFlow() into SharedExpenseFormState (Shell reads it for the modal title)', () => {
    expect(TestBed.inject(SharedExpenseFormState).isPersonalFlow()).toBe(false);
  });
});

describe('SharedExpenseForm without an active group', () => {
  let fixture: ComponentFixture<SharedExpenseForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { createShared: vi.fn() } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue([]), groups$: of([]) } },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    fixture.detectChanges();
  });

  it('shows a message instead of the form', () => {
    expect(fixture.nativeElement.textContent).toContain('Primero crea o únete a un grupo');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
});

// Fase 9 (corrección posterior al primer intento de "grupos personales"):
// "+ Agregar gasto" en CUALQUIER grupo abre este mismo formulario — con un
// solo miembro, solo cambia la presentación (título, secciones visibles,
// texto del botón), nunca la lógica de guardado.
describe('SharedExpenseForm with a single-member group (Fase 9, personal-flow UI)', () => {
  let component: SharedExpenseForm;
  let fixture: ComponentFixture<SharedExpenseForm>;
  let createShared: ReturnType<typeof vi.fn>;

  const soloMember = [{ uid: 'u1', displayName: 'Diego', email: 'diego@example.com', photoURL: '' }];

  beforeEach(async () => {
    createShared = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [SharedExpenseForm],
      providers: [
        { provide: MovementsService, useValue: { createShared } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue(soloMember) } },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SharedExpenseForm);
    component = fixture.componentInstance;
    TestBed.inject(ActiveGroup).select('group-personal');
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('detects the personal flow and publishes it to SharedExpenseFormState', () => {
    expect(component.isPersonalFlow()).toBe(true);
    expect(TestBed.inject(SharedExpenseFormState).isPersonalFlow()).toBe(true);
  });

  it('hides "¿Quién pagó?" and "División", keeps Monto/Categoría/Fecha/Nota', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).not.toContain('¿Quién pagó?');
    expect(text).not.toContain('División');
    expect(text).toContain('Monto');
    expect(text).toContain('Categoría');
    expect(text).toContain('Fecha');
    expect(text).toContain('Nota');
  });

  it('labels the submit button "Agregar gasto", not "Agregar gasto compartido"', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
    expect(button.textContent?.trim()).toBe('Agregar gasto');
  });

  it('still saves paidBy = the sole member with an implicit 100% equal split', async () => {
    component.form.controls.amount.setValue(50000);
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.categoryId.setValue('cat-expense');

    await component.submit();

    expect(createShared).toHaveBeenCalledWith(
      expect.objectContaining({
        paidBy: 'u1',
        splitType: 'equal',
        splits: [{ uid: 'u1', amount: 50000, settled: false }],
      })
    );
  });
});
