import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyJwt } from './lib/jwt-utils';

const COOKIE_NAME = 'appglpi_session';

const ROLE_TO_DASHBOARD: Record<string, string> = {
  admin: '/dashboard/admin',
  coordinador_sistemas: '/dashboard/coordinador',
  tecnico_sistemas: '/dashboard/coordinador',
  priorizador: '/dashboard/priorizador',
  referente: '/dashboard/referente',
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const sessionCookie = request.cookies.get(COOKIE_NAME);
  if (!sessionCookie?.value) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const payload = verifyJwt(sessionCookie.value);
  if (!payload) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const allowedDashboard = ROLE_TO_DASHBOARD[payload.role];

  if (!allowedDashboard) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!pathname.startsWith(allowedDashboard)) {
    return NextResponse.redirect(new URL(allowedDashboard, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/dashboard/:path*',
};
