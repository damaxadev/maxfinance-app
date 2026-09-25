// Orígenes permitidos para llamar al Worker desde un navegador: `ng serve`
// local, y la app empacada en Android — Capacitor no configura `server` en
// capacitor.config.ts, así que usa sus defaults documentados (androidScheme
// 'https' + hostname 'localhost'), es decir https://localhost. Las llamadas
// servidor-a-servidor (X-Internal-Key, Cloud Functions) no pasan por CORS —
// esto es exclusivamente para las llamadas del navegador/WebView.
const ALLOWED_ORIGINS = new Set(['http://localhost:4200', 'https://localhost']);

export function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Key',
    Vary: 'Origin',
  };
}

export function corsPreflightResponse(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
