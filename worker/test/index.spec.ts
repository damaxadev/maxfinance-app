import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe('maxfinance-worker', () => {
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

  it('accepts a valid X-Internal-Key and reaches the not-yet-implemented AI call', async () => {
    const request = new IncomingRequest('https://example.com/summary', {
      method: 'POST',
      headers: { 'X-Internal-Key': env.INTERNAL_KEY },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(501);
  });

  // La verificación de ID tokens de Firebase (JWKS remoto + RS256) se prueba
  // manualmente / en Fase 7, cuando el endpoint tenga lógica real que probar.

  it('responds 404 for unknown routes (integration style)', async () => {
    const response = await SELF.fetch('https://example.com/');
    expect(response.status).toBe(404);
  });
});
