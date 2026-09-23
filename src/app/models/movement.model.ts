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
  accountId: string;
  categoryId: string;
  type: MovementType;
  amount: number;
  date: Timestamp;
  note: string;
}

export interface PersonalMovement extends BaseMovement {
  groupId: null;
}

export interface SharedMovement extends BaseMovement {
  groupId: string;
  paidBy: Uid;
  splitType: SplitType;
  splits: MovementSplit[];
}

export type Movement = PersonalMovement | SharedMovement;
