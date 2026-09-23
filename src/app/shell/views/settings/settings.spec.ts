import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { Settings } from './settings';
import { Categories } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';

const fakeCategories = [
  { id: 'cat1', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const },
  { id: 'cat2', uid: 'u1', name: 'Mascotas', icon: '🐶', type: 'expense' as const },
];

describe('Settings', () => {
  let component: Settings;
  let fixture: ComponentFixture<Settings>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Settings],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('only shows custom categories (uid != null), not the base/seed ones', () => {
    expect(component.customCategories().map((c) => c.id)).toEqual(['cat2']);
  });

  it('delegates opening the category modal in create mode to the shared CategoryFormState', () => {
    const state = TestBed.inject(CategoryFormState);
    component.openCreateCategory();
    expect(state.request()).toEqual({ mode: 'create' });
  });

  it('delegates opening the category modal in edit mode to the shared CategoryFormState', () => {
    const state = TestBed.inject(CategoryFormState);
    component.openEditCategory(fakeCategories[1]);
    expect(state.request()).toEqual({ mode: 'edit', category: fakeCategories[1] });
  });
});
