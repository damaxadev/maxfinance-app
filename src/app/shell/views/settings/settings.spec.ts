import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Settings } from './settings';
import { Auth } from '../../../core/auth/auth';
import { Budgets } from '../../../core/budgets/budgets';
import { Categories } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';
import { GroupsService } from '../../../core/groups/groups';
import { MovementsService } from '../../../core/movements/movements';
import { ThemeService } from '../../../core/theme/theme';

const fakeCategories = [
  { id: 'cat-food', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const },
  { id: 'cat-transport', uid: null, name: 'Transporte', icon: '🚌', type: 'expense' as const },
  { id: 'cat2', uid: 'u1', name: 'Mascotas', icon: '🐶', type: 'expense' as const },
  { id: 'cat-income', uid: null, name: 'Salario', icon: '💼', type: 'income' as const },
];

function ts(date: Date) {
  return { toDate: () => date } as never;
}

function configure(opts: { budgets?: unknown[]; movements?: unknown[]; setLimit?: ReturnType<typeof vi.fn> } = {}) {
  return TestBed.configureTestingModule({
    imports: [Settings],
    providers: [
      provideNoopAnimations(),
      provideRouter([]),
      { provide: Auth, useValue: { currentUser: { uid: 'u1' } } },
      { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      { provide: GroupsService, useValue: { groups$: of([]) } },
      { provide: MovementsService, useValue: { combinedMovements$: () => of(opts.movements ?? []) } },
      // ThemeToggle (renderizado dentro de Settings) inyecta ThemeService
      // directamente — se stubea acá para no depender de @capacitor/preferences
      // real; su propio comportamiento se prueba en theme.spec.ts.
      { provide: ThemeService, useValue: { theme: signal('dark').asReadonly(), toggle: vi.fn().mockResolvedValue(undefined) } },
      {
        provide: Budgets,
        useValue: {
          budgetsForMonth$: () => of(opts.budgets ?? []),
          setLimit: opts.setLimit ?? vi.fn().mockResolvedValue(undefined),
          removeLimit: vi.fn().mockResolvedValue(undefined),
        },
      },
    ],
  }).compileComponents();
}

describe('Settings', () => {
  let component: Settings;
  let fixture: ComponentFixture<Settings>;

  beforeEach(async () => {
    const now = new Date();
    await configure({
      budgets: [{ id: 'b1', uid: 'u1', categoryId: 'cat-food', month: 'x', limit: 200 }],
      movements: [{ categoryId: 'cat-food', amount: 150, type: 'expense', date: ts(now) }],
    });

    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the appearance section with the theme toggle', () => {
    expect(fixture.nativeElement.textContent).toContain('Apariencia');
    expect(fixture.nativeElement.querySelector('mfx-theme-toggle')).toBeTruthy();
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
    component.openEditCategory(fakeCategories[2]);
    expect(state.request()).toEqual({ mode: 'edit', category: fakeCategories[2] });
  });

  it('no longer has a notifications toggle here (moved to Recurrentes)', () => {
    expect(fixture.nativeElement.textContent).not.toContain('notificaciones');
    expect(fixture.nativeElement.querySelector('mfx-checkbox')).toBeNull();
  });

  it('only lists categories that already have a budget this month (opt-in)', () => {
    expect(component.budgetedProgress().map((p) => p.categoryId)).toEqual(['cat-food']);
  });

  it('lists expense categories WITHOUT a budget yet as candidates to add', () => {
    expect(component.unbudgetedExpenseCategories().map((c) => c.id)).toEqual(['cat-transport', 'cat2']);
  });

  it('computes progress (limit/spent/percentage) for a budgeted category', () => {
    expect(component.budgetedProgress()[0]).toEqual({ categoryId: 'cat-food', limit: 200, spent: 150, percentage: 75 });
  });

  it('opens the add-budget inline form, defaulted to the unbudgeted categories', () => {
    component.openAddBudget();
    fixture.detectChanges();

    expect(component.addingBudget()).toBe(true);
    const options = Array.from<HTMLOptionElement>(fixture.nativeElement.querySelectorAll('select option'));
    expect(options.map((o) => o.value)).not.toContain('cat-food'); // ya presupuestada
  });

  it('submitAddBudget() creates the budget and closes the inline form', async () => {
    const setLimit = vi.fn().mockResolvedValue(undefined);
    TestBed.resetTestingModule();
    await configure({ setLimit });
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();

    component.openAddBudget();
    component.addBudgetForm.setValue({ categoryId: 'cat-transport', limit: 100000 });

    await component.submitAddBudget();

    expect(setLimit).toHaveBeenCalledWith({ categoryId: 'cat-transport', month: expect.any(String), limit: 100000 });
    expect(component.addingBudget()).toBe(false);
  });

  it('does not submit an invalid add-budget form', async () => {
    const setLimit = vi.fn();
    TestBed.resetTestingModule();
    await configure({ setLimit });
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.openAddBudget();

    await component.submitAddBudget();

    expect(setLimit).not.toHaveBeenCalled();
  });

  it('shows an inline error if adding a budget fails', async () => {
    const setLimit = vi.fn().mockRejectedValue(new Error('boom'));
    TestBed.resetTestingModule();
    await configure({ setLimit });
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.openAddBudget();
    component.addBudgetForm.setValue({ categoryId: 'cat-transport', limit: 100000 });

    await component.submitAddBudget();

    expect(component.budgetError()).toBe('No pudimos agregar la categoría. Intenta de nuevo.');
  });

  it('startEditLimit() opens inline editing prefilled with the current limit', () => {
    component.startEditLimit(component.budgetedProgress()[0]);

    expect(component.editingCategoryId()).toBe('cat-food');
    expect(component.editLimitControl.value).toBe(200);
  });

  it('saveEditLimit() persists the new limit and closes the inline editor', async () => {
    const setLimit = vi.fn().mockResolvedValue(undefined);
    TestBed.resetTestingModule();
    await configure({ setLimit, budgets: [{ id: 'b1', uid: 'u1', categoryId: 'cat-food', month: 'x', limit: 200 }] });
    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.startEditLimit(component.budgetedProgress()[0]);
    component.editLimitControl.setValue(500000);

    await component.saveEditLimit('cat-food');

    expect(setLimit).toHaveBeenCalledWith({ categoryId: 'cat-food', month: expect.any(String), limit: 500000 });
    expect(component.editingCategoryId()).toBeNull();
  });

  it('cancelEditLimit() closes the inline editor without saving', () => {
    component.startEditLimit(component.budgetedProgress()[0]);
    component.cancelEditLimit();

    expect(component.editingCategoryId()).toBeNull();
  });

  it('removeBudget() calls Budgets.removeLimit()', async () => {
    const budgetsService = TestBed.inject(Budgets);

    await component.removeBudget('cat-food');

    expect(budgetsService.removeLimit).toHaveBeenCalledWith('cat-food', expect.any(String));
  });

  it('shows an inline error if removing a budget fails', async () => {
    const budgetsService = TestBed.inject(Budgets);
    vi.mocked(budgetsService.removeLimit).mockRejectedValue(new Error('boom'));

    await component.removeBudget('cat-food');

    expect(component.budgetError()).toBe('No pudimos quitar la categoría. Intenta de nuevo.');
  });
});

describe('Settings with no budgeted categories yet', () => {
  let fixture: ComponentFixture<Settings>;

  beforeEach(async () => {
    await configure({ budgets: [] });
    fixture = TestBed.createComponent(Settings);
    fixture.detectChanges();
  });

  it('shows the empty state instead of any category card', () => {
    expect(fixture.nativeElement.textContent).toContain('Todavía no presupuestas ninguna categoría');
  });
});
