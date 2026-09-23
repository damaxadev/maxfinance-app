/**
 * MaxFinance Worker — AI proxy (Anthropic API) in front of Firebase-authenticated
 * clients and server-to-server calls from Cloud Functions.
 *
 * - Run `npm run dev` to start a local dev server.
 * - Run `npm run deploy` to publish the Worker.
 * - After changing bindings/vars in `wrangler.toml`, run `npm run cf-typegen`.
 */

import { authenticate, type Env } from './auth';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function handleSummary(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  if (!auth.ok) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // TODO (Fase 7): construir el resumen financiero con la Anthropic API.
  // - Leer del body el contexto (movimientos, presupuestos, grupo, etc.).
  // - Armar el prompt y llamar a https://api.anthropic.com/v1/messages
  //   con el header `x-api-key: env.ANTHROPIC_API_KEY`.
  // - Devolver el texto de la respuesta al cliente.
  return jsonResponse({ error: 'not_implemented' }, 501);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/summary') {
      return handleSummary(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
