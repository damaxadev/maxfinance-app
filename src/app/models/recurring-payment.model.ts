import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

interface BaseRecurringPayment {
  name: string;
  amount: number;
  categoryId: string;
  accountId: string;
  /** Ej.: 'monthly' | 'weekly' — DATABASE.md deja la lista abierta ("etc") */
  frequency: string;
  nextDate: Timestamp;
  active: boolean;
}

export interface PersonalRecurringPayment extends BaseRecurringPayment {
  uid: Uid;
  groupId: null;
}

export interface GroupRecurringPayment extends BaseRecurringPayment {
  uid: null;
  groupId: string;
}

export type RecurringPayment = PersonalRecurringPayment | GroupRecurringPayment;
