import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export interface User {
  uid: Uid;
  displayName: string;
  email: string;
  photoURL: string;
  createdAt: Timestamp;
}
