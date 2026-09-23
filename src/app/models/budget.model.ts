import type { Uid } from './shared.model';

export interface Budget {
  uid: Uid;
  categoryId: string;
  /** Formato YYYY-MM */
  month: string;
  limit: number;
}
