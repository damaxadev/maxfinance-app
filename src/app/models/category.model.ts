import type { Uid } from './shared.model';

export type CategoryType = 'income' | 'expense';

export interface Category {
  /** null = categoría base/global (seed) */
  uid: Uid | null;
  name: string;
  icon: string;
  type: CategoryType;
}
