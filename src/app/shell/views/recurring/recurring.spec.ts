import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Notifications } from '../../../core/notifications/notifications';
import { RecurringPaymentFormState } from '../../../core/recurring-payment-form-state/recurring-payment-form-state';
import { RecurringPayments } from '../../../core/recurring-payments/recurring-payments';
import { Recurring } from './recurring';

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

function configure(opts: {
  recurring?: unknown[];
  checkStatus?: ReturnType<typeof vi.fn>;
  enable?: ReturnType<typeof vi.fn>;
} = {}) {
  return TestBed.configureTestingModule({
    imports: [Recurring],
    providers: [
      provideNoopAnimations(),
      { provide: RecurringPayments, useValue: { personalRecurringPayments$: of(opts.recurring ?? []) } },
      {
        provide: Notifications,
        useValue: {
          checkStatus: opts.checkStatus ?? vi.fn().mockResolvedValue('prompt'),
          enable: opts.enable ?? vi.fn().mockResolvedValue('granted'),
        },
      },
    ],
  }).compileComponents();
}

describe('Recurring', () => {
  let component: Recurring;
  let fixture: ComponentFixture<Recurring>;

  beforeEach(async () => {
    await configure();

    fixture = TestBed.createComponent(Recurring);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the empty state for recurring payments', () => {
    expect(fixture.nativeElement.textContent).toContain('No tienes pagos recurrentes todavía');
  });

  it('openCreateRecurring() opens the shared form state in create mode', () => {
    const state = TestBed.inject(RecurringPaymentFormState);
    component.openCreateRecurring();
    expect(state.request()).toEqual({ mode: 'create' });
  });

  it('openEditRecurring() opens the shared form state with the given payment', () => {
    const state = TestBed.inject(RecurringPaymentFormState);
    const payment = { id: 'r1' } as never;
    component.openEditRecurring(payment);
    expect(state.request()).toEqual({ mode: 'edit', payment });
  });

  it('starts unchecked and enabled when there is no notifications permission yet', () => {
    expect(component.notificationsControl.value).toBe(false);
    expect(component.notificationsControl.disabled).toBe(false);
  });

  it('checking the toggle calls enable() and disables it once granted', async () => {
    component.notificationsControl.setValue(true);
    await flushMicrotasks();

    expect(component.notificationsControl.value).toBe(true);
    expect(component.notificationsControl.disabled).toBe(true);
  });

  it('reverts the toggle and shows a message when the permission is denied', async () => {
    const enable = vi.fn().mockResolvedValue('denied');
    TestBed.resetTestingModule();
    await configure({ enable });
    fixture = TestBed.createComponent(Recurring);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();

    component.notificationsControl.setValue(true);
    await flushMicrotasks();

    expect(component.notificationsControl.value).toBe(false);
    expect(component.notificationsMessage()).toContain('No concediste el permiso');
  });
});

describe('Recurring with recurring payments', () => {
  let fixture: ComponentFixture<Recurring>;

  beforeEach(async () => {
    await configure({
      recurring: [
        { id: 'r1', uid: 'u1', groupId: null, name: 'Netflix', amount: 30000, active: true },
        { id: 'r2', uid: 'u1', groupId: null, name: 'Gimnasio', amount: 80000, active: false },
      ],
    });

    fixture = TestBed.createComponent(Recurring);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('renders a card per recurring payment with its active/inactive status', () => {
    const rows = fixture.nativeElement.querySelectorAll('.mfx-recurring__row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Netflix');
    expect(rows[0].textContent).toContain('Activo');
    expect(rows[1].textContent).toContain('Inactivo');
  });
});

describe('Recurring when notifications are already granted', () => {
  let component: Recurring;
  let fixture: ComponentFixture<Recurring>;

  beforeEach(async () => {
    await configure({ checkStatus: vi.fn().mockResolvedValue('granted') });

    fixture = TestBed.createComponent(Recurring);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('shows the toggle already checked and disabled', () => {
    expect(component.notificationsControl.value).toBe(true);
    expect(component.notificationsControl.disabled).toBe(true);
  });
});
