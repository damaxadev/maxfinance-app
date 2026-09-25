import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ActiveTabState } from '../../core/active-tab-state/active-tab-state';
import { Auth } from '../../core/auth/auth';
import { Profile } from './profile';

function ts(date: Date) {
  return { toDate: () => date } as never;
}

const fakeUserDocument = {
  uid: 'u1',
  displayName: 'Ada',
  email: 'ada@example.com',
  photoURL: '',
  createdAt: ts(new Date('2026-01-15')),
  phone: '3001234567',
};

describe('Profile', () => {
  let component: Profile;
  let fixture: ComponentFixture<Profile>;
  let updateDisplayName: ReturnType<typeof vi.fn>;
  let updatePhone: ReturnType<typeof vi.fn>;

  const fakeUser = { uid: 'u1', displayName: 'Ada', email: 'ada@example.com', photoUrl: 'https://example.com/a.png' };

  beforeEach(async () => {
    updateDisplayName = vi.fn().mockResolvedValue(undefined);
    updatePhone = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [Profile],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        {
          provide: Auth,
          useValue: {
            currentUser$: of(fakeUser),
            currentUser: fakeUser,
            userDocument$: of(fakeUserDocument),
            updateDisplayName,
            updatePhone,
            signOut: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Profile);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('initializes the display name draft from the current user', () => {
    expect(component.displayNameDraft()).toBe('Ada');
  });

  it('saves the edited display name', async () => {
    component.onDisplayNameInput('Ada Lovelace');
    await component.save();

    expect(updateDisplayName).toHaveBeenCalledWith('Ada Lovelace');
    expect(component.saved()).toBe(true);
  });

  it('shows the real photo when photoUrl is present and loads fine', () => {
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('.mfx-avatar');
    expect(img.tagName).toBe('IMG');
  });

  it('falls back to an initial avatar if the photo fails to load', () => {
    fixture.detectChanges();

    const img: HTMLImageElement = fixture.nativeElement.querySelector('img.mfx-avatar');
    img.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    const fallback = fixture.nativeElement.querySelector('.mfx-avatar--fallback');
    expect(fallback).toBeTruthy();
    expect(fallback.textContent.trim()).toBe('A');
  });

  it('initializes the phone draft from the user document once it resolves', () => {
    expect(component.phoneDraft()).toBe('3001234567');
  });

  it('shows email and "Miembro desde" as read-only fields', () => {
    fixture.detectChanges();

    const readonlyFields = fixture.nativeElement.querySelectorAll('.mfx-profile__field--readonly');
    expect(readonlyFields.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('ada@example.com');
    expect(fixture.nativeElement.textContent).toContain('Miembro desde');
    expect(fixture.nativeElement.textContent).toContain('enero');
    expect(fixture.nativeElement.textContent).toContain('2026');
  });

  it('saves both the display name and the phone together', async () => {
    component.onDisplayNameInput('Ada Lovelace');
    component.onPhoneInput('3009999999');

    await component.save();

    expect(updateDisplayName).toHaveBeenCalledWith('Ada Lovelace');
    expect(updatePhone).toHaveBeenCalledWith('3009999999');
    expect(component.saved()).toBe(true);
  });

  it('renders "Cerrar sesión" as its own full-width button (not a discreet inline link)', () => {
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-profile__signout');
    expect(button.textContent?.trim()).toBe('Cerrar sesión');
    expect(button.tagName).toBe('BUTTON');
    // Vive fuera de mfx-profile__card, como su propio CTA — no metido en
    // el mismo bloque que "Guardar cambios".
    expect(fixture.nativeElement.querySelector('.mfx-profile__card').contains(button)).toBe(false);
  });

  it('goBack() requests the Ajustes tab and navigates to /inicio', async () => {
    const activeTabState = TestBed.inject(ActiveTabState);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.goBack();

    expect(activeTabState.requestedIndex()).toBe(4);
    expect(navigateSpy).toHaveBeenCalledWith(['/inicio']);
  });

  it('renders a "‹ Volver" button wired to goBack()', () => {
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const backButton: HTMLButtonElement = fixture.nativeElement.querySelector('.mfx-profile__back');

    backButton.click();

    expect(TestBed.inject(ActiveTabState).requestedIndex()).toBe(4);
  });
});

describe('Profile without a photo URL', () => {
  let component: Profile;
  let fixture: ComponentFixture<Profile>;

  const fakeUserNoPhoto = { uid: 'u2', displayName: 'bruno', photoUrl: '' };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Profile],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        {
          provide: Auth,
          useValue: {
            currentUser$: of(fakeUserNoPhoto),
            currentUser: fakeUserNoPhoto,
            userDocument$: of(null),
            updateDisplayName: vi.fn(),
            updatePhone: vi.fn(),
            signOut: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Profile);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows the initial avatar fallback directly, uppercased', () => {
    const fallback = fixture.nativeElement.querySelector('.mfx-avatar--fallback');
    expect(fallback).toBeTruthy();
    expect(fallback.textContent.trim()).toBe('B');
  });
});
