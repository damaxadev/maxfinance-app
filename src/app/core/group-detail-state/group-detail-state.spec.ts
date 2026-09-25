import { TestBed } from '@angular/core/testing';

import { GroupDetailState } from './group-detail-state';

describe('GroupDetailState', () => {
  let service: GroupDetailState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GroupDetailState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed', () => {
    expect(service.groupId()).toBeNull();
  });

  it('opens with the given group id', () => {
    service.open('group1');
    expect(service.groupId()).toBe('group1');
  });

  it('closes back to null', () => {
    service.open('group1');
    service.close();
    expect(service.groupId()).toBeNull();
  });
});
