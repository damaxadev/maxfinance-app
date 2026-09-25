import { TestBed } from '@angular/core/testing';

import { SettlementFormState } from './settlement-form-state';

describe('SettlementFormState', () => {
  let service: SettlementFormState;
  const fakeContext = {
    groupId: 'group1',
    fromUid: 'u1',
    toUid: 'u2',
    amount: 50,
    fromName: 'Diego',
    toName: 'Ana',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SettlementFormState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed', () => {
    expect(service.context()).toBeNull();
  });

  it('opens with the given context', () => {
    service.open(fakeContext);
    expect(service.context()).toEqual(fakeContext);
  });

  it('closes back to null', () => {
    service.open(fakeContext);
    service.close();
    expect(service.context()).toBeNull();
  });
});
