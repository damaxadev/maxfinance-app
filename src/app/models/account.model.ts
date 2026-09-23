import type { Uid } from './shared.model';

export type AccountType = 'efectivo' | 'banco' | 'tarjeta';

export interface Account {
  uid: Uid;
  name: string;
  type: AccountType;
  balance: number;
  currency: string;
}
