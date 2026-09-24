import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface Env {
  ANTHROPIC_API_KEY: string;
  INTERNAL_KEY: string;
  FIREBASE_PROJECT_ID: string;
  AI_SUMMARY_CACHE: KVNamespace;
}

export type AuthResult =
  | { ok: true; source: 'firebase'; uid: string }
  | { ok: true; source: 'internal' }
  | { ok: false };

// Firebase's documented JWKS endpoint for verifying ID tokens with a
// third-party JWT library: https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
const FIREBASE_JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
);

// createRemoteJWKSet caches the fetched keys (and respects cache-control),
// so keep a single instance per isolate instead of refetching per request.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks() {
  jwks ??= createRemoteJWKSet(FIREBASE_JWKS_URL);
  return jwks;
}

/**
 * Verifies a Firebase Auth ID token and returns the signed-in user's uid,
 * or null if the token is missing, expired, or otherwise invalid.
 */
async function verifyFirebaseIdToken(token: string, projectId: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    });

    // Extra checks Firebase recommends beyond standard JWT validation.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    if (typeof payload.auth_time !== 'number' || payload.auth_time > Date.now() / 1000) return null;

    return payload.sub;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Authenticates an incoming request for the AI endpoints, accepting either:
 * - `X-Internal-Key: <INTERNAL_KEY>` for server-to-server calls (Cloud Functions), or
 * - `Authorization: Bearer <Firebase ID token>` for calls from the frontend.
 */
export async function authenticate(request: Request, env: Env): Promise<AuthResult> {
  const internalKey = request.headers.get('X-Internal-Key');
  if (internalKey && env.INTERNAL_KEY && timingSafeEqual(internalKey, env.INTERNAL_KEY)) {
    return { ok: true, source: 'internal' };
  }

  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (token) {
    const uid = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID);
    if (uid) {
      return { ok: true, source: 'firebase', uid };
    }
  }

  return { ok: false };
}
