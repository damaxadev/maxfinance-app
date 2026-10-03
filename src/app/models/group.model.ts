import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export type GroupType = 'personal' | 'shared' | 'savings';

export type GoalReminderFrequency = 'weekly' | 'biweekly' | 'monthly';

// Elegido al crear una meta, fijo de por vida (igual que targetAmount/
// celebrationAmount, ver GoalForm) — 'target': progreso = % de
// targetAmount, hitos en 25/50/75/100%. 'open-ended': sin monto objetivo,
// progreso = % hacia el PRÓXIMO múltiplo de celebrationAmount, reiniciado
// después de cada celebración (ver goal-progress.ts).
export type GoalMode = 'target' | 'open-ended';

export interface Group {
  name: string;
  members: Uid[];
  createdBy: Uid;
  createdAt: Timestamp;
  // Elegido al crear, nunca cambia después (Fase 9). Grupos creados antes
  // de esta fase no tienen el campo — se tratan como 'shared' (ver
  // isSharedGroup()), que es lo que eran hasta ahora.
  type?: GroupType;
  // Todo lo siguiente solo aplica cuando type === 'savings' (ver
  // isSavingsGoal()) — meta de ahorro: un ledger de aportes/retiros
  // (colección goalEntries) totalmente aparte de movements/settlements,
  // sin balance de deuda entre personas.
  goalMode?: GoalMode;
  // Presente solo en modo 'target' (null en modo 'open-ended').
  targetAmount?: number | null;
  // Presente solo en modo 'open-ended' (null en modo 'target').
  celebrationAmount?: number | null;
  // Hitos de confetti ya celebrados EN LA VIDA de la meta (nunca se
  // "des-celebran" si el progreso baja y vuelve a subir, ver
  // GoalEntryForm) — percentiles (25/50/75/100) en modo 'target', o
  // múltiplos enteros de celebrationAmount ya alcanzados (1, 2, 3...) en
  // modo 'open-ended'. Mismo patrón que members (arrayUnion sobre un
  // array en el propio doc del grupo, ver GroupsService.markMilestonesReached).
  reachedMilestones?: number[];
  targetDate?: Timestamp | null;
  reminderFrequency?: GoalReminderFrequency | null;
  reminderSuggestedAmount?: number | null;
  // Próxima fecha en que toca enviar el recordatorio de aporte — solo
  // presente si reminderFrequency está configurado. Permite que la Cloud
  // Function filtre con un rango de un solo campo (ver
  // functions/src/index.ts, remindSavingsGoalContributions): ningún otro
  // type de grupo llega a tener este campo, así que no hace falta un
  // índice compuesto ni un segundo filtro por type.
  nextReminderDate?: Timestamp | null;
}

export function isSharedGroup(group: { type?: GroupType } | null | undefined): boolean {
  return (group?.type ?? 'shared') !== 'personal';
}

// type === 'savings' es su propio tercer tipo de grupo (ver DATABASE.md) —
// isSharedGroup() sigue devolviendo true para él (no es 'personal'), así
// que cualquier branch que distinga "balance de deuda" vs "gasto personal"
// debe chequear isSavingsGoal() PRIMERO, antes de caer en isSharedGroup().
export function isSavingsGoal(group: { type?: GroupType } | null | undefined): boolean {
  return group?.type === 'savings';
}
