import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export interface Settlement {
  groupId: string;
  fromUid: Uid;
  toUid: Uid;
  amount: number;
  date: Timestamp;
  note: string;
  // Presente solo si, al registrar el settlement, también se creó un
  // movement personal equivalente (checkbox opcional en el formulario).
  linkedMovementId: string | null;
}
