import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export type MovementType = 'income' | 'expense';
export type SplitType = 'equal' | 'percentage' | 'fixed';

export interface MovementSplit {
  uid: Uid;
  amount: number;
  settled: boolean;
}

interface BaseMovement {
  uid: Uid;
  categoryId: string;
  type: MovementType;
  amount: number;
  date: Timestamp;
  note: string;
}

export interface PersonalMovement extends BaseMovement {
  groupId: null;
  accountId: string;
  // Presente solo si este movimiento se generó al convertir un settlement
  // en movimiento personal (ver DATABASE.md, sección de settlements).
  settlementId?: string | null;
}

export interface SharedMovement extends BaseMovement {
  groupId: string;
  paidBy: Uid;
  splitType: SplitType;
  splits: MovementSplit[];
  // accountId es opcional acá porque solo tenemos acceso a la cuenta de
  // quien REGISTRA el movimiento — si paidBy es otro miembro del grupo,
  // no hay ninguna cuenta suya que se pueda leer/tocar (son siempre
  // privadas, ver reglas de Firestore), así que queda sin definir.
  accountId?: string | null;
}

export type Movement = PersonalMovement | SharedMovement;
