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
// Separado de ANTHROPIC_MODEL a propósito (aunque hoy apunten al mismo
// modelo) — así /receipt se puede subir a algo más fuerte (p. ej. Sonnet)
// si un recibo arrugado/borroso no da buenos resultados con Haiku, sin
// tocar /summary ni /monthly-summary.
const RECEIPT_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Límite de "máximo una consulta real cada 24h por usuario" (ver DESIGN.md,
// "IA bajo demanda") — dentro de esta ventana se devuelve el resultado
// cacheado en KV en vez de llamar a Claude de nuevo.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT = `Eres el asistente financiero de MaxFinance, una app de finanzas familiares para Colombia. Te paso el balance por cuenta, los gastos del mes agrupados por categoría y el estado del presupuesto (si el usuario configuró uno) de una sola persona.

Escribe en español de Colombia, con tuteo (nunca voseo), en un tono cercano y positivo, como si le hablaras a un amigo — nunca como un asesor formal ni un reporte contable. Responde en texto plano, sin markdown, sin viñetas ni títulos.

Primero un párrafo breve (2-3 frases) resumiendo cómo le fue este mes. Después, en un párrafo aparte, dale 2 o 3 observaciones o sugerencias concretas y prácticas basadas en los números exactos que te dieron — no inventes cifras ni categorías que no aparezcan en los datos. Máximo 120 palabras en total.`;

// Usado por /monthly-summary (insight automático mensual, ver
// handleMonthlySummary) — mismo tono y formato que SYSTEM_PROMPT, pero
// aclara que este resumen se generó solo, no porque el usuario lo pidió en
// este momento.
const MONTHLY_SYSTEM_PROMPT = `Eres el asistente financiero de MaxFinance, una app de finanzas familiares para Colombia. Este es el resumen automático que la app le envía a un usuario al cierre de cada mes (él no lo pidió en este momento, se genera solo) — te paso el balance por cuenta, los gastos del mes que acaba de cerrar agrupados por categoría y el estado del presupuesto (si el usuario configuró uno).

Escribe en español de Colombia, con tuteo (nunca voseo), en un tono cercano y positivo, como si le hablaras a un amigo — nunca como un asesor formal ni un reporte contable. Responde en texto plano, sin markdown, sin viñetas ni títulos.

Primero un párrafo breve (2-3 frases) resumiendo cómo le fue en el mes que acaba de terminar. Después, en un párrafo aparte, dale 2 o 3 observaciones o sugerencias concretas y prácticas basadas en los números exactos que te dieron — no inventes cifras ni categorías que no aparezcan en los datos. Máximo 120 palabras en total.`;

// Usado por /receipt (lectura automática de recibos, ver MovementForm) — a
// diferencia de los dos de arriba, esto NUNCA genera prosa para el usuario:
// la salida es puramente datos que el frontend usa para pre-llenar un
// formulario, así que el prompt pide JSON estricto en vez de un tono
// conversacional.
const RECEIPT_SYSTEM_PROMPT = `Eres un extractor de datos de recibos y facturas de compra para MaxFinance, una app de finanzas personales en Colombia. Te paso la foto o el PDF de un recibo.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, sin bloques de código markdown (nunca uses \`\`\`). El JSON debe tener EXACTAMENTE estos campos:

{
  "amount": number | null,
  "currency": string | null,
  "date": string | null,
  "merchant": string | null,
  "suggestedCategory": string | null,
  "lineItems": [{"description": string, "amount": number}] | null,
  "confidence": "high" | "medium" | "low"
}

- "amount": el monto total pagado, solo el número (sin símbolo de moneda ni separadores de miles).
- "currency": código ISO 4217 de 3 letras (ej. "COP", "USD"). Si el recibo no indica moneda pero es claramente de Colombia (nombres, direcciones, NIT, etc.), usa "COP".
- "date": fecha de la compra en formato ISO 8601 "YYYY-MM-DD".
- "merchant": nombre del comercio o establecimiento, tal como aparece.
- "suggestedCategory": una o dos palabras en español describiendo el tipo de gasto (ej. "Supermercado", "Restaurante", "Transporte", "Farmacia", "Ropa").
- "lineItems": los ítems de línea si se alcanzan a leer con claridad; si no, null. Nunca inventes ítems que no estén.
- "confidence": qué tan seguro estás de la extracción EN CONJUNTO. Usa "low" si la imagen no es un recibo/factura, está borrosa, o no puedes leer la mayoría de los campos con confianza.

Deja en null cualquier campo que no puedas determinar con razonable certeza — nunca inventes valores para rellenar el JSON.`;

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

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

const RECEIPT_ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
// Topes distintos por tipo, no uno parejo — los límites reales de Anthropic
// también lo son: 5MB base64 por IMAGEN (confirmado en su documentación,
// error "Image exceeds 5 MB maximum size limit" si te pasas), vs. 32MB de
// REQUEST TOTAL cuando el documento es un PDF (deja margen bajo ese techo).
// Base64 infla ~4/3 el tamaño real. Rechazar temprano acá, antes de llamar
// a Anthropic, convierte lo que sería un 502 opaco (la API rechazando el
// request) en un 400 limpio del lado del Worker.
const RECEIPT_MAX_IMAGE_BASE64_CHARS = 5 * 1024 * 1024;
const RECEIPT_MAX_PDF_BASE64_CHARS = 30 * 1024 * 1024;

interface ReceiptRequestBody {
  mediaType: string;
  data: string;
}

// Allowlist de mediaType + tope de tamaño (por tipo, ver arriba) — rechaza
// temprano, antes de llamar a Anthropic, cualquier cosa que no sea
// exactamente lo que AttachmentPicker/prepareForAi() produce. Cualquiera
// con un ID token de Firebase válido puede llegar hasta acá; esto evita
// que mande cualquier archivo arbitrario (o uno demasiado pesado) a mi
// cuenta de Anthropic.
function isValidReceiptBody(value: unknown): value is ReceiptRequestBody {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.mediaType !== 'string' ||
    !RECEIPT_ALLOWED_MEDIA_TYPES.has(body.mediaType) ||
    typeof body.data !== 'string' ||
    body.data.length === 0
  ) {
    return false;
  }
  const maxChars = body.mediaType === 'application/pdf' ? RECEIPT_MAX_PDF_BASE64_CHARS : RECEIPT_MAX_IMAGE_BASE64_CHARS;
  return body.data.length <= maxChars;
}

interface ReceiptExtraction {
  amount: number | null;
  currency: string | null;
  date: string | null;
  merchant: string | null;
  suggestedCategory: string | null;
  lineItems: { description: string; amount: number }[] | null;
  confidence: 'high' | 'medium' | 'low';
}

const EMPTY_RECEIPT_EXTRACTION: ReceiptExtraction = {
  amount: null,
  currency: null,
  date: null,
  merchant: null,
  suggestedCategory: null,
  lineItems: null,
  confidence: 'low',
};

// Claude normalmente obedece "sin bloques de código markdown", pero no hay
// garantía — esto le quita las fences ```/```json si las puso de todas
// formas, antes de parsear. Cualquier JSON inválido o con el shape
// incorrecto cae de vuelta a "no sé nada de este recibo" (confidence
// 'low', todo null) en vez de tirar un 502: el frontend ya sabe caer en
// silencio a entrada manual con eso, sin necesitar distinguir "la IA no
// pudo leer el recibo" de "Claude devolvió texto raro".
function parseReceiptExtraction(raw: string): ReceiptExtraction {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<ReceiptExtraction>;
    const confidence =
      parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
        ? parsed.confidence
        : 'low';
    return {
      amount: typeof parsed.amount === 'number' ? parsed.amount : null,
      currency: typeof parsed.currency === 'string' ? parsed.currency : null,
      date: typeof parsed.date === 'string' ? parsed.date : null,
      merchant: typeof parsed.merchant === 'string' ? parsed.merchant : null,
      suggestedCategory: typeof parsed.suggestedCategory === 'string' ? parsed.suggestedCategory : null,
      lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : null,
      confidence,
    };
  } catch (error) {
    console.error('No se pudo parsear la respuesta de Anthropic como JSON de recibo', error);
    return EMPTY_RECEIPT_EXTRACTION;
  }
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

// content acepta un string plano (SYSTEM_PROMPT/MONTHLY_SYSTEM_PROMPT, como
// siempre) o un array de bloques (texto + imagen/documento, usado por
// /receipt) — la API de Anthropic acepta las dos formas tal cual en
// `messages[].content`, así que generalizar esto no cambia nada para los
// dos endpoints existentes.
async function callAnthropic(
  env: Env,
  model: string,
  systemPrompt: string,
  content: string | AnthropicContentBlock[],
  maxTokens = 400
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
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
    summary = await callAnthropic(env, ANTHROPIC_MODEL, SYSTEM_PROMPT, buildUserPrompt(rawBody));
  } catch (error) {
    console.error('Error al generar el resumen con la API de Anthropic', error);
    return jsonResponse({ error: 'ai_unavailable' }, 502, origin);
  }

  const generatedAt = new Date().toISOString();
  await env.AI_SUMMARY_CACHE.put(cacheKey, JSON.stringify({ summary, generatedAt } satisfies CachedSummary));

  // Contador de consultas reales (no cacheadas) — lo único que consulta
  // Ajustes ("Uso de IA", ver handleUsage) para mostrar cuántas veces se ha
  // usado "Analizar balances", sin inventar una cifra en dólares.
  const countKey = `summary-count:${uid}`;
  const currentCountRaw = await env.AI_SUMMARY_CACHE.get(countKey);
  const nextCount = (currentCountRaw ? parseInt(currentCountRaw, 10) : 0) + 1;
  await env.AI_SUMMARY_CACHE.put(countKey, String(nextCount));

  return jsonResponse({ summary, cached: false, generatedAt }, 200, origin);
}

// Flujo servidor-a-servidor del insight automático mensual (ver
// functions/src/index.ts, generateMonthlyInsights) — solo acepta
// X-Internal-Key, nunca un ID token de Firebase, porque nadie hace esta
// llamada desde el navegador. A diferencia de /summary, NUNCA toca
// AI_SUMMARY_CACHE: compartir esa caché de 24h pisaría el resultado bajo
// demanda del usuario (o al revés) — este es un proceso completamente
// aparte, ya controlado por correr una sola vez al mes (ver DESIGN.md/
// BACKLOG 56).
async function handleMonthlySummary(request: Request, env: Env, origin: string | null): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok || auth.source !== 'internal') {
    return jsonResponse({ error: 'unauthorized' }, 401, origin);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400, origin);
  }

  if (!isValidSummaryBody(rawBody) || !rawBody.uid) {
    return jsonResponse({ error: 'invalid_body' }, 400, origin);
  }

  let summary: string;
  try {
    summary = await callAnthropic(env, ANTHROPIC_MODEL, MONTHLY_SYSTEM_PROMPT, buildUserPrompt(rawBody));
  } catch (error) {
    console.error('Error al generar el insight mensual con la API de Anthropic', error);
    return jsonResponse({ error: 'ai_unavailable' }, 502, origin);
  }

  return jsonResponse({ summary, generatedAt: new Date().toISOString() }, 200, origin);
}

interface UsageResponse {
  count: number;
  nextAvailableAt: string | null;
}

// Consultado por Ajustes ("Uso de IA", ver DESIGN.md/BACKLOG 57) — solo
// acepta un ID token de Firebase (es el propio usuario consultando su
// propio uso, nunca una llamada servidor-a-servidor).
async function handleUsage(request: Request, env: Env, origin: string | null): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok || auth.source !== 'firebase') {
    return jsonResponse({ error: 'unauthorized' }, 401, origin);
  }

  const countRaw = await env.AI_SUMMARY_CACHE.get(`summary-count:${auth.uid}`);
  const count = countRaw ? parseInt(countRaw, 10) : 0;

  let nextAvailableAt: string | null = null;
  const cachedRaw = await env.AI_SUMMARY_CACHE.get(`summary:${auth.uid}`);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw) as CachedSummary;
    const generatedAtMs = new Date(cached.generatedAt).getTime();
    if (Date.now() - generatedAtMs < CACHE_TTL_MS) {
      nextAvailableAt = new Date(generatedAtMs + CACHE_TTL_MS).toISOString();
    }
  }

  return jsonResponse({ count, nextAvailableAt } satisfies UsageResponse, 200, origin);
}

const RECEIPT_DAILY_LIMIT = 50;
const RECEIPT_USER_PROMPT = 'Extrae los datos de este recibo según el formato indicado.';

// Tope blando de 50 lecturas/día por uid, en el mismo KV que /summary.
// Solo acepta Firebase (esto siempre lo dispara un usuario en vivo
// adjuntando un recibo, nunca Cloud Functions). AI_SUMMARY_CACHE es
// eventually-consistent entre regiones de Cloudflare — bien para un freno
// blando al gasto en Anthropic, pero esto NUNCA debe tratarse como un
// control estricto (dos requests casi simultáneas podrían colarse un poco
// por encima del tope).
async function handleReceipt(request: Request, env: Env, origin: string | null): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok || auth.source !== 'firebase') {
    return jsonResponse({ error: 'unauthorized' }, 401, origin);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400, origin);
  }

  if (!isValidReceiptBody(rawBody)) {
    return jsonResponse({ error: 'invalid_body' }, 400, origin);
  }

  const countKey = `receipt-count:${auth.uid}:${new Date().toISOString().slice(0, 10)}`;
  const currentCountRaw = await env.AI_SUMMARY_CACHE.get(countKey);
  const currentCount = currentCountRaw ? parseInt(currentCountRaw, 10) : 0;
  if (currentCount >= RECEIPT_DAILY_LIMIT) {
    return jsonResponse({ error: 'rate_limited' }, 429, origin);
  }

  const contentBlock: AnthropicContentBlock =
    rawBody.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: rawBody.mediaType, data: rawBody.data } }
      : { type: 'image', source: { type: 'base64', media_type: rawBody.mediaType, data: rawBody.data } };

  let raw: string;
  try {
    raw = await callAnthropic(
      env,
      RECEIPT_MODEL,
      RECEIPT_SYSTEM_PROMPT,
      [contentBlock, { type: 'text', text: RECEIPT_USER_PROMPT }],
      1024
    );
  } catch (error) {
    console.error('Error al leer el recibo con la API de Anthropic', error);
    return jsonResponse({ error: 'ai_unavailable' }, 502, origin);
  }

  // Solo cuenta contra el tope una llamada que de verdad llegó a Anthropic
  // (no un 401/400/429 de más arriba) — así un reintento tras un fallo
  // transitorio no castiga doble. TTL de 2 días: solo housekeeping (la
  // clave ya cambia sola cada día por la fecha en countKey), para que KV no
  // acumule una entrada por usuario por día para siempre.
  await env.AI_SUMMARY_CACHE.put(countKey, String(currentCount + 1), { expirationTtl: 60 * 60 * 24 * 2 });

  return jsonResponse(parseReceiptExtraction(raw), 200, origin);
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

    if (request.method === 'POST' && url.pathname === '/monthly-summary') {
      return handleMonthlySummary(request, env, origin);
    }

    if (request.method === 'GET' && url.pathname === '/summary/usage') {
      return handleUsage(request, env, origin);
    }

    if (request.method === 'POST' && url.pathname === '/receipt') {
      return handleReceipt(request, env, origin);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders(origin) });
  },
} satisfies ExportedHandler<Env>;
