import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import worker from '../src/index';

// jwtVerify hace verificación RS256 real contra el JWKS remoto de Google —
// no hay forma práctica de firmar un token válido en un test sin la clave
// privada real (ver el comentario más abajo, que ya documentaba esto para
// los tests que solo usan X-Internal-Key). Mockear el módulo entero permite
// además probar el camino de autenticación Firebase (handleUsage, y el
// rechazo por tipo de auth incorrecto en handleMonthlySummary) sin esa
// limitación.
const { jwtVerify } = vi.hoisted(() => ({ jwtVerify: vi.fn() }));
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => 'fake-jwks'),
  jwtVerify,
}));

function mockFirebaseToken(uid: string): void {
  jwtVerify.mockResolvedValue({ payload: { sub: uid, auth_time: Math.floor(Date.now() / 1000) - 10 } });
}

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

function validBody(uid: string) {
  return {
    uid,
    accounts: [{ name: 'Efectivo', balance: 100000 }],
    categoryTotals: [{ category: 'Mercado', total: 50000 }],
    budget: { limit: 200000, spent: 50000, percentage: 25 },
  };
}

function summaryRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new IncomingRequest('https://example.com/summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Internal-Key': env.INTERNAL_KEY, ...headers },
    body: JSON.stringify(body),
  });
}

function anthropicResponse(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
}

function monthlySummaryRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new IncomingRequest('https://example.com/monthly-summary', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Internal-Key': env.INTERNAL_KEY, ...headers },
    body: JSON.stringify(body),
  });
}

function usageRequest(idToken: string, headers: Record<string, string> = {}): Request {
  return new IncomingRequest('https://example.com/summary/usage', {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}`, ...headers },
  });
}

describe('maxfinance-worker', () => {
  beforeEach(() => {
    // Por defecto un token "Bearer" cualquiera falla la verificación (como
    // pasaría con uno real que no está firmado) — los tests que necesitan
    // un uid autenticado llaman a mockFirebaseToken() explícitamente.
    jwtVerify.mockReset().mockRejectedValue(new Error('invalid token (mocked)'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('responds 404 for unknown routes', async () => {
    const request = new IncomingRequest('https://example.com/');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });

  it('responds 401 on POST /summary without credentials', async () => {
    const request = new IncomingRequest('https://example.com/summary', { method: 'POST' });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it('responds 401 on POST /summary with a wrong X-Internal-Key', async () => {
    const request = new IncomingRequest('https://example.com/summary', {
      method: 'POST',
      headers: { 'X-Internal-Key': 'wrong-key' },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  // La verificación de ID tokens de Firebase (JWKS remoto + RS256) se prueba
  // manualmente — no hay forma práctica de firmar un token válido en el test
  // sin la clave privada real de Google. Estos tests usan X-Internal-Key,
  // que ejercita la misma lógica de handleSummary() después de authenticate().

  it('responds 400 when the body is missing accounts/categoryTotals', async () => {
    const request = summaryRequest({ uid: 'user-1' });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_body' });
  });

  it('responds 400 when authenticated via X-Internal-Key without a uid in the body', async () => {
    const request = summaryRequest({ accounts: [], categoryTotals: [] });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'uid_required' });
  });

  it('calls Anthropic and caches the fresh result in KV when there is no cache yet', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropicResponse('Este mes te fue bien.'));

    const request = summaryRequest(validBody('user-fresh'));
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: string; cached: boolean; generatedAt: string };
    expect(body.summary).toBe('Este mes te fue bien.');
    expect(body.cached).toBe(false);
    expect(new Date(body.generatedAt).toString()).not.toBe('Invalid Date');

    const stored = await env.AI_SUMMARY_CACHE.get('summary:user-fresh');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string).summary).toBe('Este mes te fue bien.');
  });

  it('returns the cached result without calling Anthropic when it is less than 24h old', async () => {
    await env.AI_SUMMARY_CACHE.put(
      'summary:user-cached',
      JSON.stringify({ summary: 'Resumen cacheado.', generatedAt: new Date().toISOString() })
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const request = summaryRequest(validBody('user-cached'));
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: string; cached: boolean };
    expect(body.summary).toBe('Resumen cacheado.');
    expect(body.cached).toBe(true);
  });

  it('calls Anthropic again when the cached result is older than 24h', async () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await env.AI_SUMMARY_CACHE.put(
      'summary:user-stale',
      JSON.stringify({ summary: 'Resumen viejo.', generatedAt: staleDate })
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropicResponse('Resumen nuevo.'));

    const request = summaryRequest(validBody('user-stale'));
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = (await response.json()) as { summary: string; cached: boolean };
    expect(body.summary).toBe('Resumen nuevo.');
    expect(body.cached).toBe(false);
  });

  it('responds 502 when the Anthropic call fails, without touching the cache', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

    const request = summaryRequest(validBody('user-error'));
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'ai_unavailable' });
    expect(await env.AI_SUMMARY_CACHE.get('summary:user-error')).toBeNull();
  });

  it('responds 404 for unknown routes (integration style)', async () => {
    const response = await SELF.fetch('https://example.com/');
    expect(response.status).toBe(404);
  });

  it('answers an OPTIONS preflight for /summary with CORS headers for an allowed origin', async () => {
    const request = new IncomingRequest('https://example.com/summary', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4200' },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4200');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('includes the CORS header on a successful /summary response for an allowed origin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropicResponse('Todo bien.'));

    const request = summaryRequest(validBody('user-cors-ok'), { Origin: 'https://localhost' });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://localhost');
  });

  it('includes the CORS header on an error response too (not just the happy path)', async () => {
    const request = new IncomingRequest('https://example.com/summary', {
      method: 'POST',
      headers: { Origin: 'http://localhost:4200' },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4200');
  });

  it('does not reflect an origin outside the allowlist', async () => {
    const request = summaryRequest(validBody('user-cors-bad'), { Origin: 'https://evil.example.com' });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  // Fase 8 (control de uso visible, ver Ajustes/handleUsage): cada
  // resultado FRESCO (no cacheado) suma 1 a summary-count:<uid> — una
  // consulta que devuelve el cacheado no debe inflar el contador.
  it('increments summary-count:<uid> on a fresh (non-cached) result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropicResponse('Primer análisis.'));

    const request = summaryRequest(validBody('user-counter'));
    const ctx = createExecutionContext();
    await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await env.AI_SUMMARY_CACHE.get('summary-count:user-counter')).toBe('1');
  });

  it('does not increment summary-count:<uid> on a cached hit', async () => {
    await env.AI_SUMMARY_CACHE.put(
      'summary:user-counter-cached',
      JSON.stringify({ summary: 'Resumen cacheado.', generatedAt: new Date().toISOString() })
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const request = summaryRequest(validBody('user-counter-cached'));
    const ctx = createExecutionContext();
    await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await env.AI_SUMMARY_CACHE.get('summary-count:user-counter-cached')).toBeNull();
  });
});

describe('POST /monthly-summary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('responds 401 without credentials', async () => {
    const request = monthlySummaryRequest(validBody('user-1'), { 'X-Internal-Key': '' });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it('responds 401 for a Firebase-style Authorization header (this endpoint is server-to-server only)', async () => {
    const request = new IncomingRequest('https://example.com/monthly-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer whatever' },
      body: JSON.stringify(validBody('user-1')),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it('responds 400 when the body is missing uid', async () => {
    const request = monthlySummaryRequest({ accounts: [], categoryTotals: [] });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(400);
  });

  it('calls Anthropic with the monthly system prompt and returns the summary, without touching AI_SUMMARY_CACHE', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(anthropicResponse('Así te fue el mes pasado.'));

    const request = monthlySummaryRequest(validBody('user-monthly'));
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { summary: string; generatedAt: string };
    expect(body.summary).toBe('Así te fue el mes pasado.');
    expect(new Date(body.generatedAt).toString()).not.toBe('Invalid Date');

    const [, requestInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const anthropicBody = JSON.parse(requestInit.body as string) as { system: string };
    expect(anthropicBody.system).toContain('se genera solo');

    // No debe pisar (ni leer) la caché de 24h de /summary — son dos
    // flujos completamente aparte (ver DESIGN.md/BACKLOG 56).
    expect(await env.AI_SUMMARY_CACHE.get('summary:user-monthly')).toBeNull();
  });

  it('responds 502 when the Anthropic call fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

    const request = monthlySummaryRequest(validBody('user-monthly-error'));
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'ai_unavailable' });
  });
});

describe('GET /summary/usage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('responds 401 without credentials', async () => {
    const request = new IncomingRequest('https://example.com/summary/usage');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it('responds 401 for X-Internal-Key (this endpoint is for the signed-in user, not server-to-server)', async () => {
    const request = new IncomingRequest('https://example.com/summary/usage', {
      headers: { 'X-Internal-Key': env.INTERNAL_KEY },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it('reports count 0 and nextAvailableAt null for a user who has never analyzed', async () => {
    mockFirebaseToken('user-never-analyzed');

    const request = usageRequest('fake-token');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 0, nextAvailableAt: null });
  });

  it('reports the real count and when the 24h window frees up again', async () => {
    mockFirebaseToken('user-with-usage');
    const generatedAt = new Date().toISOString();
    await env.AI_SUMMARY_CACHE.put('summary-count:user-with-usage', '3');
    await env.AI_SUMMARY_CACHE.put('summary:user-with-usage', JSON.stringify({ summary: 'x', generatedAt }));

    const request = usageRequest('fake-token');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    const body = (await response.json()) as { count: number; nextAvailableAt: string | null };
    expect(body.count).toBe(3);
    expect(body.nextAvailableAt).toBe(new Date(new Date(generatedAt).getTime() + 24 * 60 * 60 * 1000).toISOString());
  });

  it('reports nextAvailableAt null once the cached result is older than 24h', async () => {
    mockFirebaseToken('user-stale-usage');
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await env.AI_SUMMARY_CACHE.put('summary-count:user-stale-usage', '5');
    await env.AI_SUMMARY_CACHE.put('summary:user-stale-usage', JSON.stringify({ summary: 'x', generatedAt: staleDate }));

    const request = usageRequest('fake-token');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(await response.json()).toEqual({ count: 5, nextAvailableAt: null });
  });
});
