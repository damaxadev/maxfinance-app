import { TestBed } from '@angular/core/testing';

import { ActiveGroup } from './active-group';

describe('ActiveGroup', () => {
  let service: ActiveGroup;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ActiveGroup);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts with no group selected', () => {
    expect(service.groupId()).toBeNull();
  });

  it('selects a group', () => {
    service.select('group1');
    expect(service.groupId()).toBe('group1');
  });

  it('can be cleared back to null', () => {
    service.select('group1');
    service.select(null);
    expect(service.groupId()).toBeNull();
  });
});
