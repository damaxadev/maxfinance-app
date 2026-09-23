import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export interface Group {
  name: string;
  members: Uid[];
  createdBy: Uid;
  createdAt: Timestamp;
}
