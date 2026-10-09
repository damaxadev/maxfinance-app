import { Injectable, signal } from '@angular/core';

import type { SettlementWithId } from '../settlements/settlements';

export interface AbonoDetailContext {
  groupId: string;
  settlementId: string;
}

/**
 * Estado compartido del modal "Detalle del abono" — mismo motivo que los
 * demás *FormState/*DetailState de esta app (Shell-level, fuera del
 * <swiper-slide>). Solo guarda groupId+settlementId, nunca el documento: el
 * componente se suscribe en vivo a settlements$(groupId) (ver AbonoDetail),
 * así que anular/editar nota/adjunto mientras el modal está abierto se ve
 * reflejado sin volver a abrirlo.
 */
@Injectable({
  providedIn: 'root',
})
export class AbonoDetailState {
  private readonly _context = signal<AbonoDetailContext | null>(null);
  readonly context = this._context.asReadonly();

  open(settlement: SettlementWithId): void {
    this._context.set({ groupId: settlement.groupId, settlementId: settlement.id });
  }

  close(): void {
    this._context.set(null);
  }
}
