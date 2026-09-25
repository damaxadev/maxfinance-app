import { TestBed } from '@angular/core/testing';

import { SharedExpenseFormState } from './shared-expense-form-state';

describe('SharedExpenseFormState', () => {
  let service: SharedExpenseFormState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SharedExpenseFormState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed', () => {
    expect(service.request()).toBeNull();
  });

  it('opens with groupId: null when called without a group (FAB — usa el grupo activo)', () => {
    service.openCreate();
    expect(service.request()).toEqual({ groupId: null });
  });

  it('opens with the given groupId when called from a specific group', () => {
    service.openCreate('group1');
    expect(service.request()).toEqual({ groupId: 'group1' });
  });

  it('closes back to null', () => {
    service.openCreate('group1');
    service.close();
    expect(service.request()).toBeNull();
  });

  it('starts isPersonalFlow as false', () => {
    expect(service.isPersonalFlow()).toBe(false);
  });

  it('setPersonalFlow() updates isPersonalFlow()', () => {
    service.setPersonalFlow(true);
    expect(service.isPersonalFlow()).toBe(true);
  });

  it('openCreate() resets isPersonalFlow to false (stale value from a previous open)', () => {
    service.setPersonalFlow(true);
    service.openCreate('group1');
    expect(service.isPersonalFlow()).toBe(false);
  });
});
