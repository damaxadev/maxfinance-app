import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { vi } from 'vitest';

import { Categories } from '../../../core/categories/categories';
import { CategoryForm } from './category-form';

describe('CategoryForm', () => {
  let component: CategoryForm;
  let fixture: ComponentFixture<CategoryForm>;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    create = vi.fn().mockResolvedValue('new-id');

    await TestBed.configureTestingModule({
      imports: [CategoryForm],
      providers: [{ provide: Categories, useValue: { create, update: vi.fn(), remove: vi.fn() } }],
    }).compileComponents();

    fixture = TestBed.createComponent(CategoryForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('does not submit an invalid form', async () => {
    component.form.patchValue({ name: '' });

    await component.submit();

    expect(create).not.toHaveBeenCalled();
  });

  it('creates a new category and emits saved', async () => {
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.setValue({ name: 'Mascotas', icon: '🐶', type: 'expense' });

    await component.submit();

    expect(create).toHaveBeenCalledWith({ name: 'Mascotas', icon: '🐶', type: 'expense' });
    expect(emitted.length).toBe(1);
  });
});

describe('CategoryForm in edit mode', () => {
  let component: CategoryForm;
  let fixture: ComponentFixture<CategoryForm>;
  let update: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;

  const existingCategory = { id: 'cat1', uid: 'u1', name: 'Mascotas', icon: '🐶', type: 'expense' as const };

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    update = vi.fn().mockResolvedValue(undefined);
    remove = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [CategoryForm],
      providers: [{ provide: Categories, useValue: { create: vi.fn(), update, remove } }],
    }).compileComponents();

    fixture = TestBed.createComponent(CategoryForm);
    fixture.componentRef.setInput('initialValue', existingCategory);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('pre-fills the form', () => {
    expect(component.form.getRawValue()).toEqual({ name: 'Mascotas', icon: '🐶', type: 'expense' });
  });

  it('updates the category', async () => {
    component.form.patchValue({ name: 'Mascotas y vet' });

    await component.submit();

    expect(update).toHaveBeenCalledWith('cat1', { name: 'Mascotas y vet', icon: '🐶', type: 'expense' });
  });

  it('deletes the category and emits deleted', async () => {
    const emitted: void[] = [];
    component.deleted.subscribe(() => emitted.push(undefined));

    await component.remove();

    expect(remove).toHaveBeenCalledWith('cat1');
    expect(emitted.length).toBe(1);
  });
});
