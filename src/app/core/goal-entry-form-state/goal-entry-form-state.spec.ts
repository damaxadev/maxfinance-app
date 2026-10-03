import { TestBed } from '@angular/core/testing';

import { GoalEntryFormState } from './goal-entry-form-state';

describe('GoalEntryFormState', () => {
  let service: GoalEntryFormState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GoalEntryFormState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts with no context', () => {
    expect(service.context()).toBeNull();
  });

  it('open() sets the context', () => {
    service.open({ groupId: 'goal1', groupName: 'Vacaciones' });
    expect(service.context()).toEqual({ groupId: 'goal1', groupName: 'Vacaciones' });
  });

  it('close() clears the context', () => {
    service.open({ groupId: 'goal1', groupName: 'Vacaciones' });
    service.close();
    expect(service.context()).toBeNull();
  });
});
