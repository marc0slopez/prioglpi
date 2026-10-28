import { isIP } from 'node:net';
import { getAuthConfig } from './config/auth-config';

export function getRequestAuditMeta(headers: Headers) {
  const forwarded = getAuthConfig().trustProxy
    ? (headers.get('x-forwarded-for')?.split(',')[0] || headers.get('x-real-ip') || '').trim()
    : '';
  const agent = headers.get('user-agent') || '';

  return {
    clientIp: isIP(forwarded) ? forwarded : null,
    userAgent: agent.slice(0, 200).replace(/[\x00-\x1f\x7f]/g, ''),
  };
}
