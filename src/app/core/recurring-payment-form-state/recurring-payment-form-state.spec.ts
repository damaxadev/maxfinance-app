import { TestBed } from '@angular/core/testing';

import { RecurringPaymentFormState } from './recurring-payment-form-state';

describe('RecurringPaymentFormState', () => {
  let service: RecurringPaymentFormState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RecurringPaymentFormState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed', () => {
    expect(service.request()).toBeNull();
  });

  it('openCreate() opens in create mode', () => {
    service.openCreate();
    expect(service.request()).toEqual({ mode: 'create' });
  });

  it('openEdit() opens with the given payment', () => {
    const payment = { id: 'r1', uid: 'u1', groupId: null, name: 'Netflix' } as never;
    service.openEdit(payment);
    expect(service.request()).toEqual({ mode: 'edit', payment });
  });

  it('close() resets to null', () => {
    service.openCreate();
    service.close();
    expect(service.request()).toBeNull();
  });
});
