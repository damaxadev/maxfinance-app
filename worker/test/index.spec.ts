import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { afterEach, describe, it, expect, vi } from 'vitest';
import worker from '../src/index';

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

describe('maxfinance-worker', () => {
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
});
