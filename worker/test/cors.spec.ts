import { describe, it, expect } from 'vitest';
import { corsHeaders, corsPreflightResponse } from '../src/cors';

describe('corsHeaders', () => {
  it('returns no headers for a missing origin', () => {
    expect(corsHeaders(null)).toEqual({});
  });

  it('returns no headers for an origin outside the allowlist', () => {
    expect(corsHeaders('https://evil.example.com')).toEqual({});
  });

  it('reflects http://localhost:4200 (ng serve)', () => {
    const headers = corsHeaders('http://localhost:4200') as Record<string, string>;
    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:4200');
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
  });

  it('reflects https://localhost (packaged Android app, Capacitor default origin)', () => {
    const headers = corsHeaders('https://localhost') as Record<string, string>;
    expect(headers['Access-Control-Allow-Origin']).toBe('https://localhost');
  });
});

describe('corsPreflightResponse', () => {
  it('responds 204 with the CORS headers for an allowed origin', () => {
    const response = corsPreflightResponse('http://localhost:4200');
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4200');
  });

  it('responds 204 without CORS headers for a disallowed origin', () => {
    const response = corsPreflightResponse('https://evil.example.com');
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
