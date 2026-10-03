import { TestBed } from '@angular/core/testing';

import { GoalFormState } from './goal-form-state';

describe('GoalFormState', () => {
  let service: GoalFormState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GoalFormState);
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
