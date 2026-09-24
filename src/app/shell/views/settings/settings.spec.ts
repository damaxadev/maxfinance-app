import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Settings } from './settings';
import { Categories } from '../../../core/categories/categories';
import { CategoryFormState } from '../../../core/category-form-state/category-form-state';
import { Notifications } from '../../../core/notifications/notifications';

const fakeCategories = [
  { id: 'cat1', uid: null, name: 'Comida', icon: '🍔', type: 'expense' as const },
  { id: 'cat2', uid: 'u1', name: 'Mascotas', icon: '🐶', type: 'expense' as const },
];

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

function configure(checkStatus: ReturnType<typeof vi.fn>, enable: ReturnType<typeof vi.fn>) {
  return TestBed.configureTestingModule({
    imports: [Settings],
    providers: [
      provideNoopAnimations(),
      provideRouter([]),
      { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      { provide: Notifications, useValue: { checkStatus, enable } },
    ],
  }).compileComponents();
}

describe('Settings', () => {
  let component: Settings;
  let fixture: ComponentFixture<Settings>;
  let checkStatus: ReturnType<typeof vi.fn>;
  let enable: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    checkStatus = vi.fn().mockResolvedValue('prompt');
    enable = vi.fn().mockResolvedValue('granted');
    await configure(checkStatus, enable);

    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
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

  it('never checks/requests permissions on its own at startup beyond the one silent checkStatus() call', () => {
    expect(checkStatus).toHaveBeenCalledTimes(1);
    expect(enable).not.toHaveBeenCalled();
  });

  it('starts unchecked and enabled when there is no permission yet', () => {
    expect(component.notificationsControl.value).toBe(false);
    expect(component.notificationsControl.disabled).toBe(false);
  });

  it('checking the toggle calls enable() and disables it once granted', async () => {
    component.notificationsControl.setValue(true);
    await flushMicrotasks();

    expect(enable).toHaveBeenCalled();
    expect(component.notificationsControl.value).toBe(true);
    expect(component.notificationsControl.disabled).toBe(true);
  });

  it('reverts the toggle and shows a message when the permission is denied', async () => {
    enable.mockResolvedValue('denied');
    component.notificationsControl.setValue(true);
    await flushMicrotasks();

    expect(component.notificationsControl.value).toBe(false);
    expect(component.notificationsMessage()).toContain('No concediste el permiso');
  });

  it('points to system settings when permanently denied', async () => {
    enable.mockResolvedValue('denied-permanently');
    component.notificationsControl.setValue(true);
    await flushMicrotasks();

    expect(component.notificationsMessage()).toContain('ajustes del sistema');
  });
});

describe('Settings when notifications are already granted', () => {
  let component: Settings;
  let fixture: ComponentFixture<Settings>;

  beforeEach(async () => {
    await configure(vi.fn().mockResolvedValue('granted'), vi.fn());

    fixture = TestBed.createComponent(Settings);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();
  });

  it('shows the toggle already checked and disabled (cannot revoke a system permission from here)', () => {
    expect(component.notificationsControl.value).toBe(true);
    expect(component.notificationsControl.disabled).toBe(true);
  });
});
