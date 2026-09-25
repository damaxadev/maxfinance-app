import { TestBed } from '@angular/core/testing';

import { BalancesModalState } from './balances-modal-state';

describe('BalancesModalState', () => {
  let service: BalancesModalState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BalancesModalState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed', () => {
    expect(service.open()).toBe(false);
  });

  it('show() opens it', () => {
    service.show();
    expect(service.open()).toBe(true);
  });

  it('close() closes it', () => {
    service.show();
    service.close();
    expect(service.open()).toBe(false);
  });
});
