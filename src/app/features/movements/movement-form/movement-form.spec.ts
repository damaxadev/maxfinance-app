import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { MovementsService } from '../../../core/movements/movements';
import { MovementForm } from './movement-form';
import type { PersonalMovement } from '../../../models/movement.model';

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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('filters categories by the selected type (defaults to expense)', () => {
    expect(component.filteredCategories().map((c) => c.id)).toEqual(['cat-expense']);
  });

  it('resets the category when the type changes to one it no longer matches', () => {
    component.form.controls.categoryId.setValue('cat-expense');

    component.form.controls.type.setValue('income');
    fixture.detectChanges(); // flush del effect que resetea categoryId

    expect(component.filteredCategories().map((c) => c.id)).toEqual(['cat-income']);
    expect(component.form.controls.categoryId.value).toBe('');
  });

  it('does not submit an invalid form', async () => {
    await component.submit();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a movement with the date parsed as local midnight', async () => {
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

    expect(create).toHaveBeenCalledTimes(1);
    const [value] = create.mock.calls[0];
    expect(value.amount).toBe(45.5);
    expect(value.accountId).toBe('acc1');
    expect(value.date.getFullYear()).toBe(2026);
    expect(value.date.getMonth()).toBe(2);
    expect(value.date.getDate()).toBe(10);
    expect(emitted.length).toBe(1);
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
