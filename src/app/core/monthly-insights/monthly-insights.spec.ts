import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { MonthlyInsights } from './monthly-insights';

const { mockDocData } = vi.hoisted(() => ({
  mockDocData: vi.fn(),
}));

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  doc: vi.fn((_fs, path, id) => ({ path, id })),
  docData: (...args: unknown[]) => mockDocData(...args),
}));

describe('MonthlyInsights', () => {
  let service: MonthlyInsights;

  function configure(user: { uid: string } | null) {
    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(user) } },
      ],
    });
    service = TestBed.inject(MonthlyInsights);
  }

  beforeEach(() => {
    mockDocData.mockReset();
  });

  it('should be created', () => {
    configure(null);
    expect(service).toBeTruthy();
  });

  it('emits null without querying Firestore when there is no signed-in user', async () => {
    configure(null);

    expect(await firstValueFrom(service.lastMonthInsight$)).toBeNull();
    expect(mockDocData).not.toHaveBeenCalled();
  });

  it('reads monthlyInsights/{uid}_{lastMonth} for the signed-in user', async () => {
    const insight = { uid: 'u1', month: '2026-02', text: 'Te fue bien en febrero.', generatedAt: {}, notifiedAt: {} };
    mockDocData.mockReturnValue(of(insight));
    configure({ uid: 'u1' });

    vi.setSystemTime(new Date('2026-03-15T12:00:00'));
    const result = await firstValueFrom(service.lastMonthInsight$);
    vi.useRealTimers();

    expect(mockDocData).toHaveBeenCalledWith(expect.objectContaining({ path: 'monthlyInsights', id: 'u1_2026-02' }));
    expect(result).toEqual(insight);
  });

  it('rolls over the year when the last month was December', async () => {
    mockDocData.mockReturnValue(of(undefined));
    configure({ uid: 'u1' });

    vi.setSystemTime(new Date('2026-01-10T12:00:00'));
    await firstValueFrom(service.lastMonthInsight$);
    vi.useRealTimers();

    expect(mockDocData).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1_2025-12' }));
  });

  it('emits null when no insight exists yet for last month', async () => {
    mockDocData.mockReturnValue(of(undefined));
    configure({ uid: 'u1' });

    expect(await firstValueFrom(service.lastMonthInsight$)).toBeNull();
  });

  it('emits null (instead of erroring) if reading Firestore fails', async () => {
    mockDocData.mockImplementation(() => {
      throw new Error('permission-denied');
    });
    configure({ uid: 'u1' });

    expect(await firstValueFrom(service.lastMonthInsight$)).toBeNull();
  });
});
