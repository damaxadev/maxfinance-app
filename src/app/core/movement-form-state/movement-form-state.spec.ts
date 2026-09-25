import { TestBed } from '@angular/core/testing';

import { MovementFormState } from './movement-form-state';
import type { PersonalMovementWithId } from '../movements/movements';

describe('MovementFormState', () => {
  let service: MovementFormState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MovementFormState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed', () => {
    expect(service.request()).toBeNull();
  });

  it('opens in create mode without a group by default', () => {
    service.openCreate();
    expect(service.request()).toEqual({ mode: 'create', groupId: null });
  });

  it('opens in create mode tagged to a personal group', () => {
    service.openCreate('personal-group-1');
    expect(service.request()).toEqual({ mode: 'create', groupId: 'personal-group-1' });
  });

  it('opens in edit mode with the given movement', () => {
    const movement = { id: 'mov1' } as PersonalMovementWithId;

    service.openEdit(movement);

    expect(service.request()).toEqual({ mode: 'edit', movement });
  });

  it('closes back to null', () => {
    service.openCreate();
    service.close();
    expect(service.request()).toBeNull();
  });
});
