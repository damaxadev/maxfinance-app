import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { Auth } from '../../core/auth/auth';
import { Login } from './login';

describe('Login', () => {
  let component: Login;
  let fixture: ComponentFixture<Login>;
  let signInWithGoogle: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    signInWithGoogle = vi.fn();

    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideNoopAnimations(),
        provideRouter([{ path: 'inicio', children: [] }]),
        { provide: Auth, useValue: { signInWithGoogle } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Login);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows a loading state while signing in and clears it afterwards', async () => {
    signInWithGoogle.mockResolvedValue({ uid: 'u1' });

    const pending = component.signInWithGoogle();
    expect(component.loading()).toBe(true);
    await pending;

    expect(component.loading()).toBe(false);
    expect(component.errorMessage()).toBeNull();
  });

  it('shows a visible error message when sign-in fails', async () => {
    signInWithGoogle.mockRejectedValue(new Error('boom'));

    await component.signInWithGoogle();

    expect(component.errorMessage()).toBe('No pudimos iniciar tu sesión. Intenta de nuevo.');
    expect(component.loading()).toBe(false);
  });
});
