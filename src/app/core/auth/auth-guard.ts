import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';

import { Auth } from './auth';

export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.currentUser$.pipe(
    take(1),
    map((user) => (user ? true : router.createUrlTree(['/login'])))
  );
};
