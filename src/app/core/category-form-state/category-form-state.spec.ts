import { TestBed } from '@angular/core/testing';

import { CategoryFormState } from './category-form-state';
import type { CategoryWithId } from '../categories/categories';

describe('CategoryFormState', () => {
  let service: CategoryFormState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CategoryFormState);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed', () => {
    expect(service.request()).toBeNull();
  });

  it('opens in create mode', () => {
    service.openCreate();
    expect(service.request()).toEqual({ mode: 'create' });
  });

  it('opens in edit mode with the given category', () => {
    const category = { id: 'cat1' } as CategoryWithId;

    service.openEdit(category);

    expect(service.request()).toEqual({ mode: 'edit', category });
  });

  it('closes back to null', () => {
    service.openCreate();
    service.close();
    expect(service.request()).toBeNull();
  });
});
