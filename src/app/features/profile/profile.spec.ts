import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../../core/auth/auth';
import { Profile } from './profile';

describe('Profile', () => {
  let component: Profile;
  let fixture: ComponentFixture<Profile>;
  let updateDisplayName: ReturnType<typeof vi.fn>;

  const fakeUser = { uid: 'u1', displayName: 'Ada', photoUrl: 'https://example.com/a.png' };

  beforeEach(async () => {
    updateDisplayName = vi.fn().mockResolvedValue(undefined);

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
            updateDisplayName,
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

    const img = fixture.nativeElement.querySelector('.mfx-profile__photo');
    expect(img.tagName).toBe('IMG');
  });

  it('falls back to an initial avatar if the photo fails to load', () => {
    fixture.detectChanges();

    component.onPhotoError();
    fixture.detectChanges();

    const fallback = fixture.nativeElement.querySelector('.mfx-profile__photo--fallback');
    expect(fallback).toBeTruthy();
    expect(fallback.textContent.trim()).toBe('A');
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
            updateDisplayName: vi.fn(),
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
    const fallback = fixture.nativeElement.querySelector('.mfx-profile__photo--fallback');
    expect(fallback).toBeTruthy();
    expect(fallback.textContent.trim()).toBe('B');
  });
});
