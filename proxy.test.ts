import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('next-intl/middleware', () => ({
  default: () => () => NextResponse.next(),
}));
vi.mock('./core/i18n/routing', () => ({ routing: {} }));
vi.mock('./shared/utils/translator-routing', () => ({
  getCanonicalNoPrefixPath: (pathname: string) => pathname,
  hasLocalePrefix: () => false,
  isTranslatorPath: () => false,
}));

function makeRequest(pathname: string, authorization?: string) {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

describe('proxy personal site protection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('PERSONAL_SITE_USERNAME', 'kana');
    vi.stubEnv('PERSONAL_SITE_PASSWORD', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
  });

  it('allows local development without a password', async () => {
    const { default: proxy } = await import('./proxy');
    const response = proxy(makeRequest('/'));
    expect(response.status).toBe(200);
  });

  it('fails closed on Vercel when the password is missing', async () => {
    vi.stubEnv('VERCEL', '1');
    const { default: proxy } = await import('./proxy');
    const response = proxy(makeRequest('/'));
    expect(response.status).toBe(503);
  });

  it('protects pages and API routes with Basic Auth', async () => {
    vi.stubEnv('PERSONAL_SITE_PASSWORD', 'secret');
    const { default: proxy } = await import('./proxy');
    const unauthorized = proxy(makeRequest('/api/translate'));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('WWW-Authenticate')).toContain('Basic');

    const credentials = btoa('kana:secret');
    const authorized = proxy(
      makeRequest('/api/translate', `Basic ${credentials}`),
    );
    expect(authorized.status).toBe(200);
  });

  it('does not treat dotted API paths as public static assets', async () => {
    vi.stubEnv('PERSONAL_SITE_PASSWORD', 'secret');
    const { default: proxy } = await import('./proxy');
    expect(proxy(makeRequest('/api/file.json')).status).toBe(401);
  });
});
