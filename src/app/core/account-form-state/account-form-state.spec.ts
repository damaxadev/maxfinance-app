import { TestBed } from '@angular/core/testing';

import { AccountFormState } from './account-form-state';
import type { AccountWithId } from '../accounts/accounts';

describe('AccountFormState', () => {
  let service: AccountFormState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AccountFormState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed', () => {
    expect(service.request()).toBeNull();
  });

  it('opens in create mode', () => {
    service.openCreate();
    expect(service.request()).toEqual({ mode: 'create' });
  });

  it('opens in edit mode with the given account', () => {
    const account = { id: 'acc1' } as AccountWithId;

    service.openEdit(account);

    expect(service.request()).toEqual({ mode: 'edit', account });
  });

  it('closes back to null', () => {
    service.openCreate();
    service.close();
    expect(service.request()).toBeNull();
  });
});
