import { isIP } from 'node:net';

export type AuthMode = 'local';

export interface AuthConfig {
  mode: AuthMode;
  jwtSecret: string;
  trustProxy: boolean;
  trustedProxyIps: string[];
}

export function getAuthConfig(): AuthConfig {
  if (process.env.AUTH_MODE !== 'local') {
    throw new Error(`Configuracion Invalida: AUTH_MODE debe ser 'local', recibido '${process.env.AUTH_MODE}'.`);
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('Configuracion Invalida: JWT_SECRET es invalido o demasiado corto (minimo 32 caracteres).');
  }

  const trustProxyValue = process.env.TRUST_PROXY;
  if (trustProxyValue !== 'true' && trustProxyValue !== 'false') {
    throw new Error(`Configuracion Invalida: TRUST_PROXY debe ser 'true' o 'false', recibido '${trustProxyValue}'.`);
  }

  const trustedProxyIps = (process.env.TRUSTED_PROXY_IPS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  for (const ip of trustedProxyIps) {
    if (!isIP(ip)) {
      throw new Error(`Configuracion Invalida: TRUSTED_PROXY_IPS contiene una IP no valida '${ip}'.`);
    }
  }

  const trustProxy = trustProxyValue === 'true';
  if (trustProxy && trustedProxyIps.length === 0) {
    throw new Error('Configuracion Invalida: TRUST_PROXY es true pero TRUSTED_PROXY_IPS esta vacio.');
  }
  if (!trustProxy && trustedProxyIps.length > 0) {
    throw new Error('Configuracion Invalida: TRUST_PROXY es false pero se definieron TRUSTED_PROXY_IPS.');
  }

  return { mode: 'local', jwtSecret, trustProxy, trustedProxyIps };
}
