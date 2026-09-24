import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';
import { MovementsService } from '../../../core/movements/movements';
import { MovementForm } from './movement-form';
import type { PersonalMovement } from '../../../models/movement.model';

const { mockImpact } = vi.hoisted(() => ({
  mockImpact: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mockImpact },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

const fakeAccounts = [
  { id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' },
];
const fakeCategories = [
  { id: 'cat-expense', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const },
  { id: 'cat-income', uid: null, name: 'Salario', icon: '💼', type: 'income' as const },
];

describe('MovementForm', () => {
  let component: MovementForm;
  let fixture: ComponentFixture<MovementForm>;
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    mockImpact.mockClear();
    create = vi.fn().mockResolvedValue(undefined);
    update = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        { provide: MovementsService, useValue: { create, update, remove } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('selectType() switches the type and triggers a light haptic', () => {
    component.selectType('income');

    expect(component.form.controls.type.value).toBe('income');
    expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('selectType() does nothing if the type is already active', () => {
    component.selectType('expense'); // ya es el valor por defecto

    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('opens the category form when "+ Nueva categoría" is picked, without keeping it as the value', () => {
    const categoryFormState = TestBed.inject(CategoryFormState);

    component.form.controls.categoryId.setValue(component.newCategoryOption);
    fixture.detectChanges();

    expect(categoryFormState.request()).toEqual({ mode: 'create' });
    expect(component.form.controls.categoryId.value).toBe('');
  });

  it('auto-selects a category just created from its own selector, syncing the movement type', () => {
    const categoryFormState = TestBed.inject(CategoryFormState);

    categoryFormState.close({ id: 'cat-income', type: 'income' });
    fixture.detectChanges();

    expect(component.form.controls.type.value).toBe('income');
    expect(component.form.controls.categoryId.value).toBe('cat-income');
    expect(categoryFormState.lastSaved()).toBeNull();
  });

  it('filters categories by the selected type (defaults to expense)', () => {
    expect(component.filteredCategories().map((c) => c.id)).toEqual(['cat-expense']);
  });

  it('does NOT reactively clear categoryId when the type changes (validated at submit time instead)', () => {
    // Regresión: un effect que limpiaba categoryId al cambiar filteredCategories()
    // corría antes de que categories() tuviera datos reales y borraba valores
    // válidos (p. ej. al editar un movimiento existente). Ahora el control no
    // se toca reactivamente; solo submit() decide si el valor es válido.
    component.form.controls.categoryId.setValue('cat-expense');

    component.form.controls.type.setValue('income');
    fixture.detectChanges();

    expect(component.filteredCategories().map((c) => c.id)).toEqual(['cat-income']);
    expect(component.form.controls.categoryId.value).toBe('cat-expense');
  });

  it('does not submit an invalid form', async () => {
    await component.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('shows every required-field error at once after submitting an empty form (markAllAsTouched)', async () => {
    // amount usa null (no 0) para simular el campo realmente vacío: así lo
    // deja NumberValueAccessor cuando el usuario borra el input, y es lo
    // único que dispara Validators.required en vez de Validators.min.
    component.form.patchValue({ amount: null as unknown as number, accountId: '', categoryId: '', date: '' });

    await component.submit();
    fixture.detectChanges();

    const errors = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.mfx-form__error')).map((el) =>
      el.textContent?.trim()
    );

    expect(errors).toContain('El monto es obligatorio.');
    expect(errors).toContain('Selecciona una cuenta.');
    expect(errors).toContain('Selecciona una categoría.');
    expect(errors).toContain('La fecha es obligatoria.');
  });

  it('shows "monto debe ser mayor a 0" when amount is 0 or negative but touched', async () => {
    component.form.patchValue({ amount: -5 });
    component.form.controls.amount.markAsTouched();
    fixture.detectChanges();

    const errors = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('.mfx-form__error')).map((el) =>
      el.textContent?.trim()
    );

    expect(errors).toContain('El monto debe ser mayor a 0.');
  });

  it('submit() rejects a categoryId that no longer matches the current type, with a visible error, without touching the control', async () => {
    component.form.setValue({
      type: 'income',
      amount: 10,
      accountId: 'acc1',
      categoryId: 'cat-expense', // ya no aplica al tipo income
      date: '2026-03-10',
      note: '',
    });

    await component.submit();

    expect(create).not.toHaveBeenCalled();
    expect(component.categoryError()).toBe('La categoría seleccionada no es válida para este tipo, elige otra.');
    expect(component.form.controls.categoryId.value).toBe('cat-expense');
  });

  it('creates a movement with the selected date and the current time of day (not midnight)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 10, 14, 30, 15));
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));

    component.form.setValue({
      type: 'expense',
      amount: 45.5,
      accountId: 'acc1',
      categoryId: 'cat-expense',
      date: '2026-03-10',
      note: 'Almuerzo',
    });

    await component.submit();
    vi.useRealTimers();

    expect(create).toHaveBeenCalledTimes(1);
    const [value] = create.mock.calls[0];
    expect(value.amount).toBe(45.5);
    expect(value.accountId).toBe('acc1');
    expect(value.date.getFullYear()).toBe(2026);
    expect(value.date.getMonth()).toBe(2);
    expect(value.date.getDate()).toBe(10);
    expect(value.date.getHours()).toBe(14);
    expect(value.date.getMinutes()).toBe(30);
    expect(value.date.getSeconds()).toBe(15);
    expect(emitted.length).toBe(1);
  });

  it('keeps the current time of day even when the date is changed to a past date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 9, 5, 0));

    component.form.setValue({
      type: 'expense',
      amount: 20,
      accountId: 'acc1',
      categoryId: 'cat-expense',
      date: '2026-03-01', // fecha pasada, elegida a propósito
      note: '',
    });

    await component.submit();
    vi.useRealTimers();

    const [value] = create.mock.calls[0];
    expect(value.date.getDate()).toBe(1);
    expect(value.date.getHours()).toBe(9);
    expect(value.date.getMinutes()).toBe(5);
  });
});

describe('MovementForm while categories are still loading', () => {
  let component: MovementForm;
  let fixture: ComponentFixture<MovementForm>;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    create = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        { provide: MovementsService, useValue: { create, update: vi.fn(), remove: vi.fn() } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of([]) } }, // todavía sin snapshot
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not reject categoryId just because categories() is still empty — lets Validators.required decide', async () => {
    component.form.setValue({
      type: 'expense',
      amount: 10,
      accountId: 'acc1',
      categoryId: 'cat-not-loaded-yet',
      date: '2026-03-10',
      note: '',
    });

    await component.submit();

    expect(create).toHaveBeenCalledTimes(1);
    expect(component.categoryError()).toBeNull();
  });
});

describe('MovementForm without accounts', () => {
  let fixture: ComponentFixture<MovementForm>;

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        { provide: MovementsService, useValue: { create: vi.fn(), update: vi.fn(), remove: vi.fn() } },
        { provide: Accounts, useValue: { accounts$: of([]) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    fixture.detectChanges();
  });

  it('shows a message instead of the form', () => {
    expect(fixture.nativeElement.textContent).toContain('Primero crea una cuenta');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
});

describe('MovementForm in edit mode', () => {
  let component: MovementForm;
  let fixture: ComponentFixture<MovementForm>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;

  const existingMovement = {
    id: 'mov1',
    uid: 'u1',
    accountId: 'acc1',
    categoryId: 'cat-expense',
    type: 'expense' as const,
    amount: 100,
    date: { toDate: () => new Date('2026-02-01T00:00:00') } as unknown as PersonalMovement['date'],
    note: 'Mercado',
    groupId: null,
  };

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    update = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        { provide: MovementsService, useValue: { create: vi.fn(), update, remove } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    fixture.componentRef.setInput('initialValue', existingMovement);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills the form from the existing movement', () => {
    expect(component.form.getRawValue()).toEqual({
      type: 'expense',
      amount: 100,
      accountId: 'acc1',
      categoryId: 'cat-expense',
      date: '2026-02-01',
      note: 'Mercado',
    });
  });

  it('updates passing the previous movement and the new form value', async () => {
    component.form.patchValue({ amount: 120 });

    await component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    const [id, previous, next] = update.mock.calls[0];
    expect(id).toBe('mov1');
    expect(previous).toBe(existingMovement);
    expect(next.amount).toBe(120);
  });

  it('deletes and emits deleted', async () => {
    const emitted: void[] = [];
    component.deleted.subscribe(() => emitted.push(undefined));

    await component.remove();

    expect(remove).toHaveBeenCalledWith('mov1', existingMovement);
    expect(emitted.length).toBe(1);
  });
});

describe('MovementForm editing an income movement (regression: type differs from the form default)', () => {
  let component: MovementForm;
  let fixture: ComponentFixture<MovementForm>;
  let update: ReturnType<typeof vi.fn>;

  // El form arranca con type: 'expense' hardcodeado — editar un movimiento
  // de tipo 'income' es justo el escenario que disparaba la carrera entre
  // el (ya eliminado) effect reactivo y la carga async de categories().
  const existingIncomeMovement = {
    id: 'mov2',
    uid: 'u1',
    accountId: 'acc1',
    categoryId: 'cat-income',
    type: 'income' as const,
    amount: 500,
    date: { toDate: () => new Date('2026-02-01T00:00:00') } as unknown as PersonalMovement['date'],
    note: 'Salario',
    groupId: null,
  };

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    update = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [MovementForm],
      providers: [
        { provide: MovementsService, useValue: { create: vi.fn(), update, remove: vi.fn() } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MovementForm);
    fixture.componentRef.setInput('initialValue', existingIncomeMovement);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills categoryId from the existing income movement without wiping it', () => {
    expect(component.form.controls.type.value).toBe('income');
    expect(component.form.controls.categoryId.value).toBe('cat-income');
  });

  it('saves successfully — no silent no-op from an invalid categoryId', async () => {
    await component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    expect(component.categoryError()).toBeNull();
    expect(component.errorMessage()).toBeNull();
  });
});
