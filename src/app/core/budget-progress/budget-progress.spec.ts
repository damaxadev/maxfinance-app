import { calculateBudgetProgress, calculateBudgetSummary, sumExpensesByCategory, type BudgetableMovement } from './budget-progress';
import type { BudgetWithId } from '../budgets/budgets';

// New Date('YYYY-MM-DD') (sin hora) se interpreta como medianoche UTC, no
// local — en cualquier zona horaria detrás de UTC eso corre el día hacia
// atrás al leer getMonth()/getDate() en hora local (justo el bug de la
// Fase 6 anterior). El constructor (year, month, day) siempre es local,
// sin esa ambigüedad.
function ts(year: number, month: number, day: number) {
  return { toDate: () => new Date(year, month - 1, day) } as never;
}

function movement(overrides: Partial<BudgetableMovement>): BudgetableMovement {
  return {
    categoryId: 'cat-food',
    amount: 50,
    type: 'expense',
    date: ts(2026, 3, 15),
    ...overrides,
  };
}

describe('sumExpensesByCategory', () => {
  it('sums expenses per category within the given month', () => {
    const movements = [
      movement({ categoryId: 'cat-food', amount: 50 }),
      movement({ categoryId: 'cat-food', amount: 30 }),
      movement({ categoryId: 'cat-transport', amount: 20 }),
    ];

    const result = sumExpensesByCategory(movements, '2026-03', 'u1');

    expect(result.get('cat-food')).toBe(80);
    expect(result.get('cat-transport')).toBe(20);
  });

  it('ignores income movements', () => {
    const movements = [movement({ type: 'income', amount: 1000 })];

    const result = sumExpensesByCategory(movements, '2026-03', 'u1');

    expect(result.size).toBe(0);
  });

  it('ignores movements outside the target month', () => {
    const movements = [movement({ date: ts(2026, 2, 28) }), movement({ date: ts(2026, 4, 1) })];

    const result = sumExpensesByCategory(movements, '2026-03', 'u1');

    expect(result.size).toBe(0);
  });

  it('counts a shared expense the current user paid, using the full amount', () => {
    const movements = [movement({ amount: 100, paidBy: 'u1' })];

    const result = sumExpensesByCategory(movements, '2026-03', 'u1');

    expect(result.get('cat-food')).toBe(100);
  });

  it('excludes a shared expense someone else paid, even if the current user registered it', () => {
    const movements = [movement({ amount: 100, paidBy: 'u2' })];

    const result = sumExpensesByCategory(movements, '2026-03', 'u1');

    expect(result.size).toBe(0);
  });

  it('counts a personal movement (no paidBy at all) regardless of uid', () => {
    const movements = [movement({ amount: 40, paidBy: undefined })];

    const result = sumExpensesByCategory(movements, '2026-03', 'u1');

    expect(result.get('cat-food')).toBe(40);
  });

  it('rounds to two decimals when summing', () => {
    const movements = [movement({ amount: 0.1 }), movement({ amount: 0.2 })];

    const result = sumExpensesByCategory(movements, '2026-03', 'u1');

    expect(result.get('cat-food')).toBe(0.3);
  });
});

describe('calculateBudgetProgress', () => {
  const budgets: BudgetWithId[] = [
    { id: 'b1', uid: 'u1', categoryId: 'cat-food', month: '2026-03', limit: 200 },
    { id: 'b2', uid: 'u1', categoryId: 'cat-transport', month: '2026-03', limit: 100 },
  ];

  it('computes spent and percentage per category', () => {
    const spent = new Map([['cat-food', 150]]);

    const result = calculateBudgetProgress(budgets, spent);

    expect(result).toEqual([
      { categoryId: 'cat-food', limit: 200, spent: 150, percentage: 75 },
      { categoryId: 'cat-transport', limit: 100, spent: 0, percentage: 0 },
    ]);
  });

  it('reports over 100% when spending exceeds the limit', () => {
    const spent = new Map([['cat-food', 250]]);

    const result = calculateBudgetProgress(budgets, spent);

    expect(result[0].percentage).toBe(125);
  });

  it('treats a zero-limit budget with spending as Infinity, not division by zero producing NaN', () => {
    const zeroLimitBudgets: BudgetWithId[] = [{ id: 'b3', uid: 'u1', categoryId: 'cat-food', month: '2026-03', limit: 0 }];
    const spent = new Map([['cat-food', 10]]);

    const result = calculateBudgetProgress(zeroLimitBudgets, spent);

    expect(result[0].percentage).toBe(Infinity);
  });

  it('treats a zero-limit budget with no spending as 0%', () => {
    const zeroLimitBudgets: BudgetWithId[] = [{ id: 'b3', uid: 'u1', categoryId: 'cat-food', month: '2026-03', limit: 0 }];

    const result = calculateBudgetProgress(zeroLimitBudgets, new Map());

    expect(result[0].percentage).toBe(0);
  });
});

describe('calculateBudgetSummary', () => {
  it('sums limits and spent across all categories', () => {
    const progress = [
      { categoryId: 'cat-food', limit: 200, spent: 150, percentage: 75 },
      { categoryId: 'cat-transport', limit: 100, spent: 120, percentage: 120 },
    ];

    const summary = calculateBudgetSummary(progress);

    expect(summary).toEqual({ totalLimit: 300, totalSpent: 270, percentage: 90 });
  });

  it('returns 0% with no budgets at all', () => {
    expect(calculateBudgetSummary([])).toEqual({ totalLimit: 0, totalSpent: 0, percentage: 0 });
  });
});
