import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export type GroupType = 'personal' | 'shared';

export interface Group {
  name: string;
  members: Uid[];
  createdBy: Uid;
  createdAt: Timestamp;
  // Elegido al crear, nunca cambia después (Fase 9). Grupos creados antes
  // de esta fase no tienen el campo — se tratan como 'shared' (ver
  // isSharedGroup()), que es lo que eran hasta ahora.
  type?: GroupType;
}

export function isSharedGroup(group: { type?: GroupType } | null | undefined): boolean {
  return (group?.type ?? 'shared') !== 'personal';
}
