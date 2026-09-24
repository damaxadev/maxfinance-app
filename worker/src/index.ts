/**
 * MaxFinance Worker — AI proxy (Anthropic API) in front of Firebase-authenticated
 * clients and server-to-server calls from Cloud Functions.
 *
 * - Run `npm run dev` to start a local dev server.
 * - Run `npm run deploy` to publish the Worker.
 * - After changing bindings/vars in `wrangler.toml`, run `npm run cf-typegen`.
 */

import { authenticate, type Env } from './auth';
import { corsHeaders, corsPreflightResponse } from './cors';

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Límite de "máximo una consulta real cada 24h por usuario" (ver DESIGN.md,
// "IA bajo demanda") — dentro de esta ventana se devuelve el resultado
// cacheado en KV en vez de llamar a Claude de nuevo.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT = `Eres el asistente financiero de MaxFinance, una app de finanzas familiares para Colombia. Te paso el balance por cuenta, los gastos del mes agrupados por categoría y el estado del presupuesto (si el usuario configuró uno) de una sola persona.

Escribe en español de Colombia, con tuteo (nunca voseo), en un tono cercano y positivo, como si le hablaras a un amigo — nunca como un asesor formal ni un reporte contable. Responde en texto plano, sin markdown, sin viñetas ni títulos.

Primero un párrafo breve (2-3 frases) resumiendo cómo le fue este mes. Después, en un párrafo aparte, dale 2 o 3 observaciones o sugerencias concretas y prácticas basadas en los números exactos que te dieron — no inventes cifras ni categorías que no aparezcan en los datos. Máximo 120 palabras en total.`;

interface AccountBalanceInput {
  name: string;
  balance: number;
}

interface CategoryTotalInput {
  category: string;
  total: number;
}

interface BudgetStatusInput {
  limit: number;
  spent: number;
  percentage: number;
}

interface SummaryRequestBody {
  // Solo se usa (y se exige) cuando la autenticación vino por X-Internal-Key
  // — una llamada de Firebase ya trae el uid del propio token verificado.
  uid?: string;
  accounts: AccountBalanceInput[];
  categoryTotals: CategoryTotalInput[];
  budget?: BudgetStatusInput | null;
}

interface CachedSummary {
  summary: string;
  generatedAt: string;
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  });
}

function isValidSummaryBody(value: unknown): value is SummaryRequestBody {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return Array.isArray(body.accounts) && Array.isArray(body.categoryTotals);
}

// currencyDisplay: 'symbol' explícito — sin él, este locale puede mostrar
// el código "COP" en vez de "$" (mismo cuidado que el pipe/directiva de
// moneda del frontend, ver src/app/shared/currency/currency.ts). El prompt
// le pide a Claude que use el símbolo, así que si esto mostrara "COP" el
// resumen generado probablemente lo repetiría.
function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    currencyDisplay: 'symbol',
    maximumFractionDigits: 0,
  }).format(value);
}

function buildUserPrompt(body: SummaryRequestBody): string {
  const accountsText = body.accounts.length
    ? body.accounts.map((account) => `- ${account.name}: ${formatCOP(account.balance)}`).join('\n')
    : '- El usuario no tiene cuentas registradas.';

  const categoriesText = body.categoryTotals.length
    ? body.categoryTotals.map((category) => `- ${category.category}: ${formatCOP(category.total)}`).join('\n')
    : '- Sin gastos registrados este mes.';

  const budgetText = body.budget
    ? `Presupuesto del mes: gastó ${formatCOP(body.budget.spent)} de ${formatCOP(body.budget.limit)} (${Math.round(body.budget.percentage)}% usado).`
    : 'El usuario no tiene un presupuesto configurado este mes.';

  return ['Balance por cuenta:', accountsText, '', 'Gastos del mes por categoría:', categoriesText, '', budgetText].join(
    '\n'
  );
}

async function callAnthropic(env: Env, userPrompt: string): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    // El body de error de Anthropic trae el detalle real (key inválida,
    // límite de tasa, request mal formado, etc.) — sin esto, el log solo
    // muestra el status y hay que adivinar la causa (ver diagnóstico de
    // Fase 7: un 401 aquí resultó ser el secret ANTHROPIC_API_KEY sin
    // configurar en este Worker).
    const detail = await response.text().catch(() => '');
    throw new Error(`anthropic_http_${response.status}: ${detail}`);
  }

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((block) => block.type === 'text')?.text;
  if (!text) {
    throw new Error('anthropic_empty_response');
  }
  return text.trim();
}

async function handleSummary(request: Request, env: Env, origin: string | null): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) {
    return jsonResponse({ error: 'unauthorized' }, 401, origin);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400, origin);
  }

  if (!isValidSummaryBody(rawBody)) {
    return jsonResponse({ error: 'invalid_body' }, 400, origin);
  }

  // Una llamada de la app ya trae un uid verificado en el propio token; una
  // llamada servidor-a-servidor (Cloud Functions) tiene que decir para qué
  // usuario es, porque X-Internal-Key no identifica a nadie en particular.
  const uid = auth.source === 'firebase' ? auth.uid : rawBody.uid;
  if (!uid) {
    return jsonResponse({ error: 'uid_required' }, 400, origin);
  }

  const cacheKey = `summary:${uid}`;
  const cachedRaw = await env.AI_SUMMARY_CACHE.get(cacheKey);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw) as CachedSummary;
    if (Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) {
      return jsonResponse({ summary: cached.summary, cached: true, generatedAt: cached.generatedAt }, 200, origin);
    }
  }

  let summary: string;
  try {
    summary = await callAnthropic(env, buildUserPrompt(rawBody));
  } catch (error) {
    console.error('Error al generar el resumen con la API de Anthropic', error);
    return jsonResponse({ error: 'ai_unavailable' }, 502, origin);
  }

  const generatedAt = new Date().toISOString();
  await env.AI_SUMMARY_CACHE.put(cacheKey, JSON.stringify({ summary, generatedAt } satisfies CachedSummary));

  return jsonResponse({ summary, cached: false, generatedAt }, 200, origin);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return corsPreflightResponse(origin);
    }

    if (request.method === 'POST' && url.pathname === '/summary') {
      return handleSummary(request, env, origin);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  },
} satisfies ExportedHandler<Env>;
