import { TestBed } from '@angular/core/testing';

import { ActiveTabState } from './active-tab-state';

describe('ActiveTabState', () => {
  let service: ActiveTabState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ActiveTabState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts with no requested tab', () => {
    expect(service.requestedIndex()).toBeNull();
  });

  it('requestTab() sets the requested index', () => {
    service.requestTab(3);
    expect(service.requestedIndex()).toBe(3);
  });

  it('consume() resets it back to null', () => {
    service.requestTab(3);
    service.consume();
    expect(service.requestedIndex()).toBeNull();
  });
});
