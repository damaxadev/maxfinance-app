import { ComponentFixture, TestBed } from '@angular/core/testing';
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
});
