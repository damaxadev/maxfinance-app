import { Injectable, inject } from '@angular/core';

import { Auth } from '../auth/auth';
import type { AiPreview } from '../attachments/attachment-compression';
import { environment } from '../../../environments/environment';

export interface ReceiptLineItem {
  description: string;
  amount: number;
}

export interface ReceiptExtraction {
  amount: number | null;
  currency: string | null;
  date: string | null;
  merchant: string | null;
  suggestedCategory: string | null;
  lineItems: ReceiptLineItem[] | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Cliente del endpoint /receipt del Worker (lectura automática de recibos,
 * ver MovementForm) — mismo patrón que AiSummary: llamada autenticada con
 * el ID token de Firebase, el Worker ya devuelve JSON limpio y parseado
 * (nunca el texto crudo de Claude ni sus fences de markdown). Soporta
 * cancelación vía AbortSignal porque esto corre automáticamente apenas se
 * adjunta el recibo — el usuario debe poder cortarlo (ver DATABASE.md,
 * "Lectura automática de recibos").
 */
@Injectable({
  providedIn: 'root',
})
export class ReceiptReader {
  private readonly auth = inject(Auth);

  async extract(preview: AiPreview, options?: { signal?: AbortSignal }): Promise<ReceiptExtraction> {
    const idToken = await this.auth.getIdToken();
    if (!idToken) {
      throw new Error('No hay una sesión activa.');
    }

    let response: Response;
    try {
      response = await fetch(`${environment.workerUrl}/receipt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ mediaType: preview.mediaType, data: preview.base64 }),
        signal: options?.signal,
      });
    } catch (error) {
      // Un abort explícito (el usuario canceló, o se reemplazó/quitó el
      // adjunto mientras leía) se deja pasar tal cual — MovementForm lo
      // distingue de un fallo real para no mostrarle nada al usuario.
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new Error('No se pudo conectar con el servicio de lectura de recibos.');
    }

    if (!response.ok) {
      throw new Error('No se pudo leer el recibo.');
    }

    return (await response.json()) as ReceiptExtraction;
  }
}
