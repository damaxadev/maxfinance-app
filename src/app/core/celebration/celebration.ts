import { Injectable } from '@angular/core';
import confetti from 'canvas-confetti';
import { Haptics, NotificationType } from '@capacitor/haptics';

// Mismos tokens que styles.scss (--primary, --accent, --text) — DESIGN.md.
const CONFETTI_COLORS = ['#00e6a8', '#ffd166', '#f5f7fa'];

/**
 * Celebración lista para usarse (Fase 5, al saldar una deuda): confetti +
 * feedback háptico de éxito. Todavía no está conectada a ningún flujo real.
 */
@Injectable({
  providedIn: 'root',
})
export class Celebration {
  async celebrate(): Promise<void> {
    confetti({
      particleCount: 140,
      spread: 70,
      origin: { y: 0.6 },
      colors: CONFETTI_COLORS,
    });

    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch {
      // Sin soporte háptico (navegador de escritorio) — el confetti ya se disparó.
    }
  }
}
