export interface LdapSearchEntry {
  dn: string;
  [key: string]: string | string[] | Buffer | Buffer[] | undefined;
}

export interface LdapClientOptions {
  url: string;
  connectTimeoutMs: number;
  operationTimeoutMs: number;
  tlsOptions: {
    rejectUnauthorized: boolean;
    minVersion: 'TLSv1.2';
    servername: string;
  };
}

export type LdapErrorCode = 'invalid_credentials' | 'timeout' | 'connection' | 'tls' | 'search' | 'unknown';

export class LdapInternalError extends Error {
  constructor(public code: LdapErrorCode, message?: string) {
    super(message || code);
    this.name = 'LdapInternalError';
  }
}

const VALID_LDAP_ERROR_CODES: readonly LdapErrorCode[] = [
  'invalid_credentials',
  'timeout',
  'connection',
  'tls',
  'search',
  'unknown'
];

export function isLdapInternalError(err: unknown): err is LdapInternalError {
  return err instanceof LdapInternalError && VALID_LDAP_ERROR_CODES.includes(err.code);
}

import type { ConnectionOptions } from 'node:tls';

export interface LdapSearchOptions {
  scope?: 'base' | 'one' | 'sub';
  filter?: string;
  attributes?: string[];
  sizeLimit?: number;
  timeLimit?: number;
}

export interface ILdapClient {
  startTLS(options?: ConnectionOptions): Promise<void>;
  bind(dn: string, passwordPlain: string): Promise<void>;
  search(base: string, options: LdapSearchOptions): Promise<{ searchEntries: LdapSearchEntry[] }>;
  unbind(): Promise<void>;
}

export interface ILdapClientFactory {
  createClient(options: LdapClientOptions): ILdapClient;
}
