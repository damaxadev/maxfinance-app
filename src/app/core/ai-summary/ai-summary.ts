import { Injectable, inject } from '@angular/core';

import { Auth } from '../auth/auth';
import { environment } from '../../../environments/environment';

export interface AccountBalanceSummary {
  name: string;
  balance: number;
}

export interface CategoryTotalSummary {
  category: string;
  total: number;
}

export interface BudgetStatusSummary {
  limit: number;
  spent: number;
  percentage: number;
}

export interface SummaryContext {
  accounts: AccountBalanceSummary[];
  categoryTotals: CategoryTotalSummary[];
  budget: BudgetStatusSummary | null;
}

export interface SummaryResult {
  summary: string;
  cached: boolean;
  generatedAt: string;
}

export interface AiUsageInfo {
  count: number;
  // null = disponible ahora mismo; si no, cuándo se libera la ventana de 24h.
  nextAvailableAt: string | null;
}

/**
 * Cliente del endpoint /summary del Worker ("Analizar balances", IA bajo
 * demanda — ver DESIGN.md). El Worker aplica su propio límite de 1 consulta
 * real cada 24h por uid (caché en Cloudflare KV); este servicio solo hace la
 * llamada autenticada y traduce errores a mensajes que el modal pueda mostrar.
 */
@Injectable({
  providedIn: 'root',
})
export class AiSummary {
  private readonly auth = inject(Auth);

  async analyze(context: SummaryContext): Promise<SummaryResult> {
    const idToken = await this.auth.getIdToken();
    if (!idToken) {
      throw new Error('No hay una sesión activa.');
    }

    let response: Response;
    try {
      response = await fetch(`${environment.workerUrl}/summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify(context),
      });
    } catch {
      throw new Error('No se pudo conectar con el servicio de análisis.');
    }

    if (!response.ok) {
      throw new Error('No se pudo generar el análisis. Intenta de nuevo más tarde.');
    }

    return (await response.json()) as SummaryResult;
  }

  // Consultado por Ajustes ("Uso de IA", ver DESIGN.md/BACKLOG 57) — cuántas
  // veces se ha usado "Analizar balances" y cuándo está disponible el próximo.
  async getUsage(): Promise<AiUsageInfo> {
    const idToken = await this.auth.getIdToken();
    if (!idToken) {
      throw new Error('No hay una sesión activa.');
    }

    let response: Response;
    try {
      response = await fetch(`${environment.workerUrl}/summary/usage`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
    } catch {
      throw new Error('No se pudo conectar con el servicio de análisis.');
    }

    if (!response.ok) {
      throw new Error('No pudimos consultar el uso de IA.');
    }

    return (await response.json()) as AiUsageInfo;
  }
}
