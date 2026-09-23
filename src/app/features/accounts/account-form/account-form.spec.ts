import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { AccountForm } from './account-form';

describe('AccountForm', () => {
  let component: AccountForm;
  let fixture: ComponentFixture<AccountForm>;
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Accounts (usado solo como token de DI acá) importa Auth, cuyo módulo
    // importa @capacitor-firebase/authentication a nivel de módulo (mockeado
    // globalmente en setup-capacitor-firebase-auth-mock.ts).
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    create = vi.fn().mockResolvedValue('new-id');
    update = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [AccountForm],
      providers: [{ provide: Accounts, useValue: { create, update, remove } }],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not submit an invalid form', async () => {
    component.form.patchValue({ name: '' });

    await component.submit();

    expect(create).not.toHaveBeenCalled();
  });

  it('creates a new account and emits saved', async () => {
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.setValue({ name: 'Nequi', type: 'banco' });

    await component.submit();

    expect(create).toHaveBeenCalledWith({ name: 'Nequi', type: 'banco' });
    expect(emitted.length).toBe(1);
  });

  it('shows an error message if saving fails', async () => {
    create.mockRejectedValue(new Error('boom'));
    component.form.setValue({ name: 'Nequi', type: 'banco' });

    await component.submit();

    expect(component.errorMessage()).toBe('No pudimos guardar la cuenta. Intenta de nuevo.');
  });
});

describe('AccountForm in edit mode', () => {
  let component: AccountForm;
  let fixture: ComponentFixture<AccountForm>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;

  const existingAccount = { id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 100, currency: 'COP' };

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    update = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [AccountForm],
      providers: [{ provide: Accounts, useValue: { create: vi.fn(), update, remove } }],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountForm);
    fixture.componentRef.setInput('initialValue', existingAccount);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills the form with the existing account', () => {
    expect(component.form.getRawValue()).toEqual({ name: 'Efectivo', type: 'efectivo' });
  });

  it('updates the existing account', async () => {
    component.form.patchValue({ name: 'Efectivo (bolsillo)' });

    await component.submit();

    expect(update).toHaveBeenCalledWith('acc1', { name: 'Efectivo (bolsillo)', type: 'efectivo' });
  });

  it('deletes the account and emits deleted', async () => {
    const emitted: void[] = [];
    component.deleted.subscribe(() => emitted.push(undefined));

    await component.remove();

    expect(remove).toHaveBeenCalledWith('acc1');
    expect(emitted.length).toBe(1);
  });

  it('surfaces the service error message if deletion is blocked', async () => {
    remove.mockRejectedValue(new Error('No puedes eliminar una cuenta con movimientos.'));

    await component.remove();

    expect(component.errorMessage()).toBe('No puedes eliminar una cuenta con movimientos.');
  });
});
