import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { vi } from 'vitest';

import { Auth } from './auth';

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: {
    getCurrentUser: vi.fn().mockResolvedValue({ user: null }),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

describe('Auth', () => {
  let service: Auth;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: Firestore, useValue: {} }],
    });
    service = TestBed.inject(Auth);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('resolves currentUser$ to null once the restored session is known', async () => {
    const user = await new Promise((resolve) => {
      service.currentUser$.subscribe(resolve);
    });
    expect(user).toBeNull();
  });
});
