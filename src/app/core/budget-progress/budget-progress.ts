import type { Timestamp } from 'firebase/firestore';

import type { BudgetWithId } from '../budgets/budgets';

export interface BudgetableMovement {
  categoryId: string;
  amount: number;
  type: string;
  date: Timestamp;
  // Presente solo en movimientos compartidos — solo cuentan para el
  // presupuesto los que el usuario actual efectivamente pagó, no los que
  // registró a nombre de otro miembro (ver createShared(): accountId, y
  // por lo tanto el dinero, solo se toca cuando paidBy === quien registra).
  paidBy?: string;
}

export interface CategoryBudgetProgress {
  categoryId: string;
  limit: number;
  spent: number;
  // 0-100+, sin tope — quien consuma esto decide cómo tratar >100.
  percentage: number;
}

export interface BudgetSummary {
  totalLimit: number;
  totalSpent: number;
  percentage: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toMonthKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

// Suma gastos por categoría dentro de month (YYYY-MM) — combina movimientos
// personales y compartidos (ya mezclados por el caller, ver
// MovementsService.combinedMovements$), usando el monto completo del gasto
// compartido (igual que se descuenta de la cuenta), no solo el split propio.
export function sumExpensesByCategory(
  movements: BudgetableMovement[],
  month: string,
  currentUid: string
): Map<string, number> {
  const sums = new Map<string, number>();
  for (const movement of movements) {
    if (movement.type !== 'expense') {
      continue;
    }
    if (movement.paidBy !== undefined && movement.paidBy !== currentUid) {
      continue;
    }
    if (toMonthKey(movement.date.toDate()) !== month) {
      continue;
    }
    sums.set(movement.categoryId, round2((sums.get(movement.categoryId) ?? 0) + movement.amount));
  }
  return sums;
}

export interface MonthlyExpenseTotal {
  month: string;
  total: number;
}

// Últimos `monthsBack` meses (incluyendo el mes de referenceDate), en orden
// ascendente y con 0 relleno para los meses sin gasto — así la gráfica de
// tendencia de Inicio siempre muestra el mismo número de puntos. Mismo
// criterio de filtrado que sumExpensesByCategory (solo gastos, solo los que
// el usuario efectivamente pagó), pero sin acotar a un solo mes.
export function sumExpensesByMonth(
  movements: BudgetableMovement[],
  currentUid: string,
  referenceDate: Date,
  monthsBack: number
): MonthlyExpenseTotal[] {
  const sums = new Map<string, number>();
  for (const movement of movements) {
    if (movement.type !== 'expense') {
      continue;
    }
    if (movement.paidBy !== undefined && movement.paidBy !== currentUid) {
      continue;
    }
    const month = toMonthKey(movement.date.toDate());
    sums.set(month, round2((sums.get(month) ?? 0) + movement.amount));
  }

  const result: MonthlyExpenseTotal[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const month = toMonthKey(new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1));
    result.push({ month, total: sums.get(month) ?? 0 });
  }
  return result;
}

export function calculateBudgetProgress(
  budgets: BudgetWithId[],
  spentByCategory: Map<string, number>
): CategoryBudgetProgress[] {
  return budgets.map((budget) => {
    const spent = spentByCategory.get(budget.categoryId) ?? 0;
    const percentage = budget.limit > 0 ? round2((spent / budget.limit) * 100) : spent > 0 ? Infinity : 0;
    return { categoryId: budget.categoryId, limit: budget.limit, spent, percentage };
  });
}

export function calculateBudgetSummary(progress: CategoryBudgetProgress[]): BudgetSummary {
  const totalLimit = round2(progress.reduce((sum, p) => sum + p.limit, 0));
  const totalSpent = round2(progress.reduce((sum, p) => sum + p.spent, 0));
  const percentage = totalLimit > 0 ? round2((totalSpent / totalLimit) * 100) : totalSpent > 0 ? Infinity : 0;
  return { totalLimit, totalSpent, percentage };
}
