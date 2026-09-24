import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Auth } from '../../../core/auth/auth';
import { Celebration } from '../../../core/celebration/celebration';
import type { SettlementContext } from '../../../core/settlement-form-state/settlement-form-state';
import { SettlementsService } from '../../../core/settlements/settlements';
import { SettlementForm } from './settlement-form';

const fakeAccounts = [{ id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' }];
const fakeContext: SettlementContext = {
  groupId: 'group1',
  fromUid: 'u1',
  toUid: 'u2',
  amount: 50,
  fromName: 'Diego',
  toName: 'Ana',
};

describe('SettlementForm (viewed by the payer, u1)', () => {
  let component: SettlementForm;
  let fixture: ComponentFixture<SettlementForm>;
  let create: ReturnType<typeof vi.fn>;
  let celebrate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = vi.fn().mockResolvedValue(undefined);
    celebrate = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [SettlementForm],
      providers: [
        { provide: SettlementsService, useValue: { create } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
        { provide: Celebration, useValue: { celebrate } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettlementForm);
    fixture.componentRef.setInput('context', fakeContext);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('prefills the amount from the context', () => {
    expect(component.form.controls.amount.value).toBe(50);
  });

  it('is the payer', () => {
    expect(component.isPayer()).toBe(true);
  });

  it('does not submit with an invalid amount', async () => {
    component.form.controls.amount.setValue(0);

    await component.submit();

    expect(create).not.toHaveBeenCalled();
  });

  it('submits without a linked personal movement by default', async () => {
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));

    await component.submit();

    expect(create).toHaveBeenCalledWith({
      groupId: 'group1',
      fromUid: 'u1',
      toUid: 'u2',
      amount: 50,
      note: '',
      personalMovementAccountId: null,
    });
    expect(celebrate).toHaveBeenCalled();
    expect(emitted.length).toBe(1);
  });

  it('renders the mfx-checkbox and clicking it checks the underlying form control', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('mfx-checkbox button');

    button.click();
    fixture.detectChanges();

    expect(component.form.controls.registerPersonalMovement.value).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });

  it('requires an account once "registrar como movimiento personal" is checked', () => {
    component.form.controls.registerPersonalMovement.setValue(true);
    fixture.detectChanges();

    expect(component.form.controls.accountId.hasError('required')).toBe(true);
    expect(component.form.invalid).toBe(true);
  });

  it('clears the account requirement again when the checkbox is unchecked', () => {
    component.form.controls.registerPersonalMovement.setValue(true);
    fixture.detectChanges();
    component.form.controls.accountId.setValue('acc1');
    component.form.controls.registerPersonalMovement.setValue(false);
    fixture.detectChanges();

    expect(component.form.controls.accountId.value).toBe('');
    expect(component.form.valid).toBe(true);
  });

  it('includes the account id when submitting with the checkbox checked', async () => {
    component.form.controls.registerPersonalMovement.setValue(true);
    fixture.detectChanges();
    component.form.controls.accountId.setValue('acc1');

    await component.submit();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ personalMovementAccountId: 'acc1' })
    );
  });

  it('shows an inline error and does not emit saved if create() fails', async () => {
    create.mockRejectedValue(new Error('boom'));
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));

    await component.submit();

    expect(component.errorMessage()).toBe('No pudimos registrar el pago. Intenta de nuevo.');
    expect(emitted.length).toBe(0);
    expect(celebrate).not.toHaveBeenCalled();
  });

  it('disables the submit button while saving or invalid', () => {
    component.form.controls.amount.setValue(0);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button');
    expect(button.disabled).toBe(true);
  });
});

describe('SettlementForm (viewed by the receiver, u2)', () => {
  let component: SettlementForm;
  let fixture: ComponentFixture<SettlementForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettlementForm],
      providers: [
        { provide: SettlementsService, useValue: { create: vi.fn().mockResolvedValue(undefined) } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Auth, useValue: { currentUser: { uid: 'u2' } } },
        { provide: Celebration, useValue: { celebrate: vi.fn().mockResolvedValue(undefined) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettlementForm);
    fixture.componentRef.setInput('context', fakeContext);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('is not the payer', () => {
    expect(component.isPayer()).toBe(false);
  });
});
