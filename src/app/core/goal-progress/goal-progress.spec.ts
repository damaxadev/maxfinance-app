import {
  computeGoalContributorBreakdown,
  computeGoalPercentage,
  computeGoalSavedAmount,
  computeOpenEndedPercentage,
  crossedMilestones,
  crossedOpenEndedMilestones,
  distinctContributorCount,
  GOAL_MILESTONES,
  newlyReachedMilestones,
} from './goal-progress';

describe('computeGoalSavedAmount', () => {
  it('sums contributions and subtracts withdrawals', () => {
    const entries = [
      { type: 'contribution' as const, amount: 100 },
      { type: 'contribution' as const, amount: 50 },
      { type: 'withdrawal' as const, amount: 30 },
    ];
    expect(computeGoalSavedAmount(entries)).toBe(120);
  });

  it('returns 0 for an empty ledger', () => {
    expect(computeGoalSavedAmount([])).toBe(0);
  });

  it('can go negative if withdrawals exceed contributions (no clamping here)', () => {
    const entries = [
      { type: 'contribution' as const, amount: 10 },
      { type: 'withdrawal' as const, amount: 40 },
    ];
    expect(computeGoalSavedAmount(entries)).toBe(-30);
  });
});

describe('computeGoalPercentage (modo "target")', () => {
  it('computes the plain percentage of the target', () => {
    expect(computeGoalPercentage(250, 1000)).toBe(25);
    expect(computeGoalPercentage(1000, 1000)).toBe(100);
  });

  it('is never clamped above 100 — surpassing the goal is good news, not an error', () => {
    expect(computeGoalPercentage(1500, 1000)).toBe(150);
  });

  it('is clamped at 0 when saved is negative (withdrawals exceeded contributions)', () => {
    expect(computeGoalPercentage(-30, 1000)).toBe(0);
  });

  it('returns 0 when the target is 0 or negative, instead of dividing by zero', () => {
    expect(computeGoalPercentage(100, 0)).toBe(0);
    expect(computeGoalPercentage(100, -10)).toBe(0);
  });
});

describe('computeOpenEndedPercentage (modo "open-ended")', () => {
  it('matches the spec example: celebrationAmount 1.000.000, saved 650.000 -> 65%', () => {
    expect(computeOpenEndedPercentage(650000, 1000000)).toEqual({ percentage: 65, multipleIndex: 0 });
  });

  it('resets to 0% right at an exact multiple — the next tier starts fresh', () => {
    expect(computeOpenEndedPercentage(1000000, 1000000)).toEqual({ percentage: 0, multipleIndex: 1 });
  });

  it('keeps climbing within the second tier past the first multiple', () => {
    expect(computeOpenEndedPercentage(1300000, 1000000)).toEqual({ percentage: 30, multipleIndex: 1 });
  });

  it('clamps saved at 0 before computing (a net-negative ledger)', () => {
    expect(computeOpenEndedPercentage(-500, 1000000)).toEqual({ percentage: 0, multipleIndex: 0 });
  });

  it('returns 0/0 when celebrationAmount is 0 or negative, instead of dividing by zero', () => {
    expect(computeOpenEndedPercentage(500, 0)).toEqual({ percentage: 0, multipleIndex: 0 });
  });
});

describe('crossedMilestones (modo "target")', () => {
  it('lists every milestone in GOAL_MILESTONES', () => {
    expect(GOAL_MILESTONES).toEqual([25, 50, 75, 100]);
  });

  it('returns the single milestone crossed by a small jump', () => {
    expect(crossedMilestones(40, 60)).toEqual([50]);
  });

  it('returns every milestone crossed by a single large contribution', () => {
    expect(crossedMilestones(0, 100)).toEqual([25, 50, 75, 100]);
  });

  it('returns nothing when no milestone is crossed', () => {
    expect(crossedMilestones(51, 55)).toEqual([]);
  });

  it('returns nothing when progress moves backward (a withdrawal)', () => {
    expect(crossedMilestones(60, 40)).toEqual([]);
  });

  // crossedMilestones() es pura y no sabe nada de qué ya se celebró —
  // SIEMPRE reporta un cruce real de before a after, sin importar que ya
  // se haya cruzado antes en una entrada previa. El filtro de "una sola
  // vez en la vida de la meta" vive en newlyReachedMilestones() (ver
  // abajo), que es quien compara contra Group.reachedMilestones.
  it('reports a crossing again on paper, even if a previous entry already crossed it (dedup is newlyReachedMilestones\' job)', () => {
    expect(crossedMilestones(40, 55)).toEqual([50]);
  });

  it('does not re-report a milestone already passed before this entry', () => {
    expect(crossedMilestones(80, 90)).toEqual([]);
  });

  it('a milestone exactly reached (not surpassed) counts as crossed', () => {
    expect(crossedMilestones(20, 25)).toEqual([25]);
  });
});

describe('crossedOpenEndedMilestones (modo "open-ended")', () => {
  it('returns the single multiple crossed by a small contribution', () => {
    expect(crossedOpenEndedMilestones(800000, 1200000, 1000000)).toEqual([1]);
  });

  it('returns every multiple crossed by a single large contribution', () => {
    expect(crossedOpenEndedMilestones(0, 3500000, 1000000)).toEqual([1, 2, 3]);
  });

  it('returns nothing when no multiple is crossed', () => {
    expect(crossedOpenEndedMilestones(100000, 200000, 1000000)).toEqual([]);
  });

  it('returns nothing when progress moves backward (a withdrawal)', () => {
    expect(crossedOpenEndedMilestones(1200000, 800000, 1000000)).toEqual([]);
  });

  it('an exact multiple reached (not surpassed) counts as crossed', () => {
    expect(crossedOpenEndedMilestones(900000, 1000000, 1000000)).toEqual([1]);
  });

  it('returns nothing when celebrationAmount is 0 or negative', () => {
    expect(crossedOpenEndedMilestones(0, 5000000, 0)).toEqual([]);
  });
});

describe('newlyReachedMilestones', () => {
  it('keeps crossed milestones that were never reached before', () => {
    expect(newlyReachedMilestones([50], [25])).toEqual([50]);
  });

  it('drops a milestone already in the persisted "reached" list — the "once in the goal\'s lifetime" rule', () => {
    // Punto de la ronda de feedback: un retiro que baja de 60% a 40% y un
    // aporte posterior que lo vuelve a subir a 55% SÍ cruza el 50% otra
    // vez (crossedMilestones), pero si Group.reachedMilestones ya tenía
    // 50 guardado de una vez anterior, no debe volver a celebrar.
    expect(newlyReachedMilestones([50], [25, 50])).toEqual([]);
  });

  it('keeps only the new ones when a single entry crosses several at once, some already reached', () => {
    expect(newlyReachedMilestones([25, 50, 75], [25])).toEqual([50, 75]);
  });

  it('returns an empty array when nothing was crossed', () => {
    expect(newlyReachedMilestones([], [25, 50])).toEqual([]);
  });
});

describe('computeGoalContributorBreakdown', () => {
  it('splits net contributions by uid, sorted highest net first', () => {
    const entries = [
      { uid: 'u1', type: 'contribution' as const, amount: 300 },
      { uid: 'u2', type: 'contribution' as const, amount: 700 },
    ];
    const breakdown = computeGoalContributorBreakdown(entries);

    expect(breakdown.map((b) => b.uid)).toEqual(['u2', 'u1']);
    expect(breakdown.map((b) => b.netAmount)).toEqual([700, 300]);
    expect(breakdown.map((b) => b.displayAmount)).toEqual([700, 300]);
    expect(breakdown.map((b) => b.percentage)).toEqual([70, 30]);
  });

  it('nets a person\'s own contributions against their own withdrawals', () => {
    const entries = [
      { uid: 'u1', type: 'contribution' as const, amount: 500 },
      { uid: 'u1', type: 'withdrawal' as const, amount: 200 },
    ];
    expect(computeGoalContributorBreakdown(entries)).toEqual([
      { uid: 'u1', netAmount: 300, displayAmount: 300, percentage: 100 },
    ]);
  });

  // El caso central de esta ronda: alguien retiró más de lo que aportó.
  // Su porción visual queda en 0, pero las de los demás se reescalan para
  // que la suma siga dando el total REAL (700), no la suma de netos
  // positivos (800) — ver el cálculo documentado en la conversación.
  it('clamps a negative net to a $0 slice and rescales the positive nets so slices sum to the REAL total', () => {
    const entries = [
      { uid: 'u1', type: 'contribution' as const, amount: 800 },
      { uid: 'u2', type: 'contribution' as const, amount: 0 },
      { uid: 'u2', type: 'withdrawal' as const, amount: 100 }, // u2 neto: -100
    ];
    const breakdown = computeGoalContributorBreakdown(entries);
    const totalReal = breakdown.reduce((sum, b) => sum + b.netAmount, 0);

    expect(totalReal).toBe(700);
    const sumDisplayed = breakdown.reduce((sum, b) => sum + b.displayAmount, 0);
    expect(sumDisplayed).toBeCloseTo(700, 5); // suma el total real, no 800

    const u1 = breakdown.find((b) => b.uid === 'u1')!;
    const u2 = breakdown.find((b) => b.uid === 'u2')!;
    expect(u1.netAmount).toBe(800); // el neto real nunca se oculta
    expect(u1.displayAmount).toBeCloseTo(700, 5); // reescalado: 800 * (700/800)
    expect(u2.netAmount).toBe(-100); // negativo, visible tal cual
    expect(u2.displayAmount).toBe(0); // nunca una porción negativa
    expect(u2.percentage).toBe(0);
  });

  it('three contributors with one negative — slices still sum to the real total', () => {
    const entries = [
      { uid: 'u1', type: 'contribution' as const, amount: 600 },
      { uid: 'u2', type: 'contribution' as const, amount: 400 },
      { uid: 'u3', type: 'withdrawal' as const, amount: 200 }, // u3 neto: -200
    ];
    const breakdown = computeGoalContributorBreakdown(entries);
    const sumDisplayed = breakdown.reduce((sum, b) => sum + b.displayAmount, 0);

    expect(sumDisplayed).toBeCloseTo(800, 5); // 600 + 400 - 200
    expect(breakdown.reduce((sum, b) => sum + b.percentage, 0)).toBeCloseTo(100, 5);
  });

  it('returns an empty array for an empty ledger', () => {
    expect(computeGoalContributorBreakdown([])).toEqual([]);
  });

  it('everyone at 0% (not NaN) when the real total is 0 or negative', () => {
    const entries = [
      { uid: 'u1', type: 'contribution' as const, amount: 100 },
      { uid: 'u1', type: 'withdrawal' as const, amount: 100 },
    ];
    const breakdown = computeGoalContributorBreakdown(entries);

    expect(breakdown).toEqual([{ uid: 'u1', netAmount: 0, displayAmount: 0, percentage: 0 }]);
  });
});

describe('distinctContributorCount', () => {
  it('counts distinct uids that made at least one contribution', () => {
    const entries = [
      { uid: 'u1', type: 'contribution' as const },
      { uid: 'u2', type: 'contribution' as const },
      { uid: 'u1', type: 'contribution' as const },
    ];
    expect(distinctContributorCount(entries)).toBe(2);
  });

  it('does not count a withdrawal-only participant as a contributor', () => {
    const entries = [
      { uid: 'u1', type: 'contribution' as const },
      { uid: 'u2', type: 'withdrawal' as const },
    ];
    expect(distinctContributorCount(entries)).toBe(1);
  });

  it('returns 0 for an empty ledger', () => {
    expect(distinctContributorCount([])).toBe(0);
  });
});
