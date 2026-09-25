import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Accounts } from '../../../core/accounts/accounts';
import { Categories } from '../../../core/categories/categories';
import { Notifications } from '../../../core/notifications/notifications';
import { RecurringPayments } from '../../../core/recurring-payments/recurring-payments';
import { RecurringPaymentForm } from './recurring-payment-form';

const fakeAccounts = [{ id: 'acc1', uid: 'u1', name: 'Efectivo', type: 'efectivo' as const, balance: 0, currency: 'COP' }];
const fakeCategories = [
  { id: 'cat-expense', uid: null, name: 'Servicios', icon: '💡', type: 'expense' as const },
  { id: 'cat-income', uid: null, name: 'Salario', icon: '💼', type: 'income' as const },
];

describe('RecurringPaymentForm (create)', () => {
  let component: RecurringPaymentForm;
  let fixture: ComponentFixture<RecurringPaymentForm>;
  let create: ReturnType<typeof vi.fn>;
  let enable: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    create = vi.fn().mockResolvedValue(undefined);
    enable = vi.fn().mockResolvedValue('granted');

    await TestBed.configureTestingModule({
      imports: [RecurringPaymentForm],
      providers: [
        { provide: RecurringPayments, useValue: { create, update: vi.fn(), remove: vi.fn() } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: Notifications, useValue: { enable } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecurringPaymentForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('only shows expense categories', () => {
    expect(component.expenseCategories()).toEqual([fakeCategories[0]]);
  });

  it('offers all 8 frequencies in Spanish, most to least frequent (Fase 9)', () => {
    const options = Array.from<HTMLOptionElement>(fixture.nativeElement.querySelectorAll('select[formControlName="frequency"] option'));
    expect(options.map((o) => o.value)).toEqual([
      'daily',
      'weekly',
      'biweekly',
      'monthly',
      'bimonthly',
      'quarterly',
      'semiannual',
      'annual',
    ]);
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Diaria',
      'Semanal',
      'Quincenal',
      'Mensual',
      'Bimestral',
      'Trimestral',
      'Semestral',
      'Anual',
    ]);
  });

  it('does not submit an invalid form', async () => {
    await component.submit();

    expect(create).not.toHaveBeenCalled();
  });

  it('creates the recurring payment and does not touch notifications when active stays false', async () => {
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.setValue({
      name: 'Netflix',
      amount: 30000,
      categoryId: 'cat-expense',
      accountId: 'acc1',
      frequency: 'monthly',
      nextDate: '2026-04-01',
      active: false,
    });

    await component.submit();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Netflix', amount: 30000, active: false })
    );
    expect(enable).not.toHaveBeenCalled();
    expect(emitted.length).toBe(1);
  });

  it('requests notifications when creating with active already true (0 -> true transition)', async () => {
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.setValue({
      name: 'Netflix',
      amount: 30000,
      categoryId: 'cat-expense',
      accountId: 'acc1',
      frequency: 'monthly',
      nextDate: '2026-04-01',
      active: true,
    });

    await component.submit();

    expect(enable).toHaveBeenCalled();
    expect(emitted.length).toBe(1);
  });

  it('shows a non-blocking message and does not emit saved when the permission is denied', async () => {
    enable.mockResolvedValue('denied');
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.setValue({
      name: 'Netflix',
      amount: 30000,
      categoryId: 'cat-expense',
      accountId: 'acc1',
      frequency: 'monthly',
      nextDate: '2026-04-01',
      active: true,
    });

    await component.submit();

    expect(create).toHaveBeenCalled();
    expect(component.notificationsMessage()).toContain('No vas a recibir notificaciones');
    expect(emitted.length).toBe(0);
  });

  it('points to system settings when the permission is permanently denied', async () => {
    enable.mockResolvedValue('denied-permanently');
    component.form.setValue({
      name: 'Netflix',
      amount: 30000,
      categoryId: 'cat-expense',
      accountId: 'acc1',
      frequency: 'monthly',
      nextDate: '2026-04-01',
      active: true,
    });

    await component.submit();

    expect(component.notificationsMessage()).toContain('ajustes del sistema');
  });

  it('still emits saved if notifications.enable() throws unexpectedly', async () => {
    enable.mockRejectedValue(new Error('boom'));
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.setValue({
      name: 'Netflix',
      amount: 30000,
      categoryId: 'cat-expense',
      accountId: 'acc1',
      frequency: 'monthly',
      nextDate: '2026-04-01',
      active: true,
    });

    await component.submit();

    expect(emitted.length).toBe(1);
  });

  it('shows an inline error if create() fails', async () => {
    create.mockRejectedValue(new Error('boom'));
    component.form.setValue({
      name: 'Netflix',
      amount: 30000,
      categoryId: 'cat-expense',
      accountId: 'acc1',
      frequency: 'monthly',
      nextDate: '2026-04-01',
      active: false,
    });

    await component.submit();

    expect(component.errorMessage()).toBe('No pudimos guardar el pago recurrente. Intenta de nuevo.');
  });

  it('disables the submit button while the form is invalid', () => {
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-form__actions button[type="submit"]');
    expect(button.disabled).toBe(true);
  });
});

describe('RecurringPaymentForm (edit)', () => {
  let component: RecurringPaymentForm;
  let fixture: ComponentFixture<RecurringPaymentForm>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let enable: ReturnType<typeof vi.fn>;

  const existingPayment = {
    id: 'r1',
    uid: 'u1',
    groupId: null as null,
    name: 'Netflix',
    amount: 30000,
    categoryId: 'cat-expense',
    accountId: 'acc1',
    frequency: 'monthly',
    // new Date(2026, 3, 1), no el string '2026-04-01': un string sin hora se
    // interpreta como medianoche UTC, no local — en una zona detrás de UTC
    // eso corre la fecha un día hacia atrás al leer getMonth()/getDate().
    nextDate: { toDate: () => new Date(2026, 3, 1) } as never,
    active: true,
  };

  beforeEach(async () => {
    update = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);
    enable = vi.fn().mockResolvedValue('granted');

    await TestBed.configureTestingModule({
      imports: [RecurringPaymentForm],
      providers: [
        { provide: RecurringPayments, useValue: { create: vi.fn(), update, remove } },
        { provide: Accounts, useValue: { accounts$: of(fakeAccounts) } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: Notifications, useValue: { enable } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecurringPaymentForm);
    fixture.componentRef.setInput('initialValue', existingPayment);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('prefills the form from the existing payment', () => {
    expect(component.form.controls.name.value).toBe('Netflix');
    expect(component.form.controls.nextDate.value).toBe('2026-04-01');
    expect(component.form.controls.active.value).toBe(true);
  });

  it('does not re-request notifications when active stays true (already active)', async () => {
    await component.submit();

    expect(update).toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
  });

  it('requests notifications on a false -> true transition while editing', async () => {
    // Reabre el formulario como si el recurrente ya existiera inactivo —
    // activatingNow compara contra initialValue() (el estado con el que se
    // abrió el formulario), no contra una llamada anterior a submit().
    fixture.componentRef.setInput('initialValue', { ...existingPayment, active: false });
    fixture.detectChanges();
    component.form.controls.active.setValue(true);

    await component.submit();

    expect(enable).toHaveBeenCalled();
  });

  it('remove() deletes and emits deleted', async () => {
    const emitted: void[] = [];
    component.deleted.subscribe(() => emitted.push(undefined));

    await component.remove();

    expect(remove).toHaveBeenCalledWith('r1');
    expect(emitted.length).toBe(1);
  });
});
