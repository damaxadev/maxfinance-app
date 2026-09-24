import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { ActiveGroup } from '../../../core/active-group/active-group';
import { Auth } from '../../../core/auth/auth';
import { Categories } from '../../../core/categories/categories';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
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
        { provide: GroupsService, useValue: { getMemberProfiles } },
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

  it('should create', () => {
    expect(component).toBeTruthy();
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
        { provide: GroupsService, useValue: { getMemberProfiles: vi.fn().mockResolvedValue([]) } },
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
