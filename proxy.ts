import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './core/i18n/routing';
import {
  getCanonicalNoPrefixPath,
  hasLocalePrefix,
  isTranslatorPath,
} from './shared/utils/translator-routing';

// Create intl middleware once at module level (more efficient)
const intlMiddleware = createMiddleware(routing);
const translatorMiddleware = createMiddleware({
  ...routing,
  localeDetection: false,
  alternateLinks: false,
});

function isStaticAsset(pathname: string): boolean {
  if (pathname.startsWith('/api/')) {
    return false;
  }

  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/_vercel/') ||
    pathname.includes('.')
  );
}

function basicAuthResponse(status = 401): NextResponse {
  const response = new NextResponse(
    status === 401
      ? 'Authentication required'
      : 'Site authentication is not configured',
    { status },
  );
  if (status === 401) {
    response.headers.set('WWW-Authenticate', 'Basic realm="KanaDojo"');
  }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function isAuthorized(request: NextRequest): boolean {
  const password = process.env.PERSONAL_SITE_PASSWORD;
  if (!password) {
    return process.env.VERCEL !== '1' && !process.env.VERCEL_ENV;
  }

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Basic ')) {
    return false;
  }

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(':');
    if (separator < 0) {
      return false;
    }
    const username = process.env.PERSONAL_SITE_USERNAME || 'kana';
    return (
      decoded.slice(0, separator) === username &&
      decoded.slice(separator + 1) === password
    );
  } catch {
    return false;
  }
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isStaticAsset(pathname)) {
    if (
      !process.env.PERSONAL_SITE_PASSWORD &&
      (process.env.VERCEL === '1' || process.env.VERCEL_ENV)
    ) {
      return basicAuthResponse(503);
    }
    if (!isAuthorized(request)) {
      return basicAuthResponse();
    }
  }

  // Fast path - skip for paths that don't need locale handling
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/_vercel') ||
    pathname.startsWith('/monitoring') ||
    pathname.startsWith('/healthcheck') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  if (hasLocalePrefix(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = getCanonicalNoPrefixPath(pathname);
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (isTranslatorPath(pathname)) {
    const response = translatorMiddleware(request);
    response.headers.set('x-locale', 'en');
    return response;
  }

  // Locale prefix is disabled; derive locale from cookie, then Accept-Language.
  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value;
  const acceptLanguage = request.headers.get('accept-language') ?? '';
  const preferredLocale = acceptLanguage.toLowerCase().startsWith('es')
    ? 'es'
    : 'en';
  const locale =
    cookieLocale === 'es' || cookieLocale === 'en'
      ? cookieLocale
      : preferredLocale;

  // Use next-intl middleware for locale handling
  const response = intlMiddleware(request);
  response.headers.set('x-locale', locale);

  return response;
}

export const config = {
  // More restrictive matcher - only match actual page routes
  // Excludes: _next, _vercel, and static files
  matcher: [
    '/((?!_next|_vercel|.*\\..*).*)',
    '/api/:path*',
  ],
};
