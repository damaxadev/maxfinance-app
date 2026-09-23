import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { vi } from 'vitest';

import { GroupsService } from '../../../core/groups/groups';
import { GroupForm } from './group-form';

describe('GroupForm', () => {
  let component: GroupForm;
  let fixture: ComponentFixture<GroupForm>;
  let create: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    create = vi.fn().mockResolvedValue('new-group-id');

    await TestBed.configureTestingModule({
      imports: [GroupForm],
      providers: [{ provide: GroupsService, useValue: { create } }],
    }).compileComponents();

    fixture = TestBed.createComponent(GroupForm);
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

  it('shows a visible error under Nombre when empty and touched', async () => {
    component.form.patchValue({ name: '' });

    await component.submit();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('.mfx-form__error');
    expect(error?.textContent).toContain('El nombre es obligatorio.');
  });

  it('creates the group and emits saved', async () => {
    const emitted: void[] = [];
    component.saved.subscribe(() => emitted.push(undefined));
    component.form.setValue({ name: 'Apartamento' });

    await component.submit();

    expect(create).toHaveBeenCalledWith('Apartamento');
    expect(emitted.length).toBe(1);
  });

  it('shows a generic error message if creation fails', async () => {
    create.mockRejectedValue(new Error('boom'));
    component.form.setValue({ name: 'Apartamento' });

    await component.submit();

    expect(component.errorMessage()).toBe('No pudimos crear el grupo. Intenta de nuevo.');
  });
});
