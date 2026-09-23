import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export interface Settlement {
  groupId: string;
  fromUid: Uid;
  toUid: Uid;
  amount: number;
  date: Timestamp;
  note: string;
}
