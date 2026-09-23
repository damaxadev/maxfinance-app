import { TestBed } from '@angular/core/testing';

import { GroupFormState } from './group-form-state';

describe('GroupFormState', () => {
  let service: GroupFormState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GroupFormState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed', () => {
    expect(service.open()).toBe(false);
  });

  it('opens on openCreate()', () => {
    service.openCreate();
    expect(service.open()).toBe(true);
  });

  it('closes back to false', () => {
    service.openCreate();
    service.close();
    expect(service.open()).toBe(false);
  });
});
