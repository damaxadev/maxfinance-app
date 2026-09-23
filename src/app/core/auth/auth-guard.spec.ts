import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, Observable, of } from 'rxjs';

import { Auth } from './auth';
import { authGuard } from './auth-guard';

describe('authGuard', () => {
  function runGuard(): Observable<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    ) as Observable<boolean | UrlTree>;
  }

  it('allows navigation when there is a signed-in user', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Auth, useValue: { currentUser$: of({ uid: 'u1' }) } }],
    });

    const result = await firstValueFrom(runGuard());
    expect(result).toBe(true);
  });

  it('redirects to /login when there is no session', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Auth, useValue: { currentUser$: of(null) } }],
    });

    const router = TestBed.inject(Router);
    const result = await firstValueFrom(runGuard());
    expect(result).toEqual(router.createUrlTree(['/login']));
  });
});
