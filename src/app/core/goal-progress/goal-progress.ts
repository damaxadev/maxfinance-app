import type { GoalEntryType } from '../../models/goal-entry.model';

// Hitos que disparan confetti en modo 'target' (ver GoalEntryForm) — no
// solo al completar la meta, para que se sienta como una racha de logros
// en el camino.
export const GOAL_MILESTONES = [25, 50, 75, 100] as const;

// Saldo real = calculado, no almacenado (mismo criterio que el balance de
// grupo, ver group-balance.ts) — una meta nunca tiene tantas entradas como
// para que sumarlas en el cliente sea un problema de rendimiento.
export function computeGoalSavedAmount(entries: { type: GoalEntryType; amount: number }[]): number {
  return entries.reduce((sum, entry) => sum + (entry.type === 'contribution' ? entry.amount : -entry.amount), 0);
}

// Modo 'target' — nunca negativo (un retiro que supere lo ahorrado no
// debería mostrar un progreso negativo) — sin tope superior: pasar el
// 100% es una buena noticia, no un error (a diferencia del uso de
// presupuesto). El llamador (GoalEntryForm/GroupDetail/Groups) es quien
// clampea a 100 para el anillo, no esta función — crossedMilestones()
// necesita el valor real sin clampear para saber si 100 ya quedó atrás.
export function computeGoalPercentage(saved: number, target: number): number {
  if (target <= 0) {
    return 0;
  }
  return Math.max(0, (saved / target) * 100);
}

// Modo 'open-ended' — sin monto objetivo: el progreso es hacia el PRÓXIMO
// múltiplo de celebrationAmount, no hacia un total fijo. multipleIndex es
// cuántos múltiplos completos ya se cruzaron (0 si saved < celebrationAmount)
// — crossedOpenEndedMilestones() lo usa para saber qué múltiplos son
// nuevos. Ej.: celebrationAmount 1.000.000, saved 650.000 -> 65%, saved
// 1.000.000 exacto -> 0% (multipleIndex 1, arranca de cero el siguiente).
export function computeOpenEndedPercentage(saved: number, celebrationAmount: number): { percentage: number; multipleIndex: number } {
  if (celebrationAmount <= 0) {
    return { percentage: 0, multipleIndex: 0 };
  }
  const safeSaved = Math.max(0, saved);
  const multipleIndex = Math.floor(safeSaved / celebrationAmount);
  const remainder = safeSaved - multipleIndex * celebrationAmount;
  return { percentage: (remainder / celebrationAmount) * 100, multipleIndex };
}

// Hitos (modo 'target') que ESTA entrada hizo cruzar (before < hito <=
// after) — ver newlyReachedMilestones() para el filtro de "una sola vez
// en la vida de la meta" (persistido en Group.reachedMilestones, no acá:
// esta función es pura y no sabe nada de qué ya se celebró).
export function crossedMilestones(percentageBefore: number, percentageAfter: number): number[] {
  return GOAL_MILESTONES.filter((milestone) => percentageBefore < milestone && percentageAfter >= milestone);
}

// Múltiplos de celebrationAmount (modo 'open-ended') que ESTA entrada hizo
// cruzar — un aporte grande puede cruzar varios de una vez (ej. 0 ->
// 3.5x con celebrationAmount fijo, cruza el 1°, 2° y 3°). Mismo criterio
// que crossedMilestones(): pura, sin saber qué ya se celebró.
export function crossedOpenEndedMilestones(savedBefore: number, savedAfter: number, celebrationAmount: number): number[] {
  if (celebrationAmount <= 0) {
    return [];
  }
  const firstMultiple = Math.floor(Math.max(0, savedBefore) / celebrationAmount) + 1;
  const crossed: number[] = [];
  for (let multiple = firstMultiple; multiple * celebrationAmount <= savedAfter; multiple++) {
    crossed.push(multiple);
  }
  return crossed;
}

// Filtra los hitos cruzados por ESTA entrada que no se habían celebrado
// todavía — GoalEntryForm persiste el resultado en Group.reachedMilestones
// (arrayUnion) y solo dispara confetti si queda algo acá: así cada hito se
// celebra una sola vez en la vida de la meta, sin importar que el progreso
// baje (un retiro) y vuelva a subir después (ver ronda de feedback).
export function newlyReachedMilestones(crossed: number[], alreadyReached: number[]): number[] {
  return crossed.filter((milestone) => !alreadyReached.includes(milestone));
}

export interface GoalContributorBreakdown {
  uid: string;
  // Neto real (aportes - retiros), puede ser negativo — nunca se oculta,
  // se muestra tal cual en la leyenda (ver GroupDetail).
  netAmount: number;
  // Para la torta: nunca negativo. Si alguien quedó en negativo, su
  // porción es 0 y los netos positivos de los demás se reescalan para que
  // la SUMA de displayAmount dé el total real ahorrado (no la suma de los
  // netos positivos) — ver el cálculo documentado en la conversación.
  displayAmount: number;
  // displayAmount / totalReal * 100 — 0 si el total real es <= 0.
  percentage: number;
}

// Desglose de aportes netos por persona (ver DATABASE.md, "Metas de
// ahorro") — solo incluye uids con al menos una entrada en el ledger
// (nunca agrega miembros del grupo que nunca participaron, con 0%).
export function computeGoalContributorBreakdown(
  entries: { uid: string; type: GoalEntryType; amount: number }[]
): GoalContributorBreakdown[] {
  const netByUid = new Map<string, number>();
  for (const entry of entries) {
    const delta = entry.type === 'contribution' ? entry.amount : -entry.amount;
    netByUid.set(entry.uid, (netByUid.get(entry.uid) ?? 0) + delta);
  }

  const nets = [...netByUid.values()];
  const totalReal = nets.reduce((sum, n) => sum + n, 0);
  const sumPositive = nets.reduce((sum, n) => sum + Math.max(0, n), 0);
  const scale = totalReal > 0 && sumPositive > 0 ? totalReal / sumPositive : 0;

  return [...netByUid.entries()]
    .map(([uid, netAmount]) => {
      const displayAmount = Math.max(0, netAmount) * scale;
      return { uid, netAmount, displayAmount, percentage: totalReal > 0 ? (displayAmount / totalReal) * 100 : 0 };
    })
    .sort((a, b) => b.netAmount - a.netAmount);
}

// Gate de "Ver aportes por persona" (ver GroupDetail) — cuenta personas
// DISTINTAS que hayan hecho al menos un aporte (no un retiro): con una
// sola, una torta de una sola porción no tiene sentido.
export function distinctContributorCount(entries: { uid: string; type: GoalEntryType }[]): number {
  return new Set(entries.filter((entry) => entry.type === 'contribution').map((entry) => entry.uid)).size;
}
