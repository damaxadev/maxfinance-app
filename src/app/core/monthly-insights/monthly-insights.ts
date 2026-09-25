import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { Firestore, Timestamp, doc, docData } from '@angular/fire/firestore';

import { Auth } from '../auth/auth';

export interface MonthlyInsight {
  uid: string;
  month: string;
  text: string;
  generatedAt: Timestamp;
  notifiedAt: Timestamp | null;
}

function previousMonthKey(date: Date): string {
  const previous = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const yyyy = previous.getFullYear();
  const mm = String(previous.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

// Insight generado automáticamente por Cloud Function el día 1 de cada mes
// (ver DATABASE.md, monthlyInsights) — nunca escrito desde el cliente. El
// doc id es determinístico ({uid}_{month}), así que un get directo por id
// alcanza para "el mes pasado", sin necesitar una query/índice para
// encontrar "el más reciente".
@Injectable({
  providedIn: 'root',
})
export class MonthlyInsights {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  readonly lastMonthInsight$: Observable<MonthlyInsight | null> = this.auth.currentUser$.pipe(
    switchMap((user) => {
      if (!user) {
        return of(null);
      }
      const month = previousMonthKey(new Date());
      const ref = doc(this.firestore, 'monthlyInsights', `${user.uid}_${month}`);
      return (docData(ref) as Observable<MonthlyInsight | undefined>).pipe(map((data) => data ?? null));
    }),
    catchError((error) => {
      console.error('Error al cargar el insight mensual', error);
      return of(null);
    })
  );
}
