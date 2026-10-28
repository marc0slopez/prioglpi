export type PrioGlpiSqlEnv = Readonly<Record<string, string | undefined>>;

export interface PrioGlpiSqlConfig {
  server: string;
  port: number;
  database: string;
  odbcDriver: 'ODBC Driver 18 for SQL Server';
  encrypt: true;
  trustServerCertificate: boolean;
  connectionTimeoutMs: number;
  requestTimeoutMs: number;
  poolMax: number;
  trustedConnection: true;
}

function parseStrictInt(value: string | undefined, min: number, max: number, fieldName: string): number {
  if (!value) throw new Error(`${fieldName} es obligatorio.`);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fieldName} debe ser un numero entero positivo sin espacios ni decimales.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldName} fuera de rango permitido (${min}-${max}).`);
  }

  return parsed;
}

function parseStrictBoolean(value: string | undefined, fieldName: string): boolean {
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${fieldName} debe ser exactamente true o false.`);
  }

  return value === 'true';
}

function parseDatabase(value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error('PRIOGLPI_SQL_DATABASE es obligatorio.');
  }
  if (value !== value.trim() || value.length > 128) {
    throw new Error('PRIOGLPI_SQL_DATABASE no debe tener espacios externos y debe tener hasta 128 caracteres.');
  }
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error('PRIOGLPI_SQL_DATABASE contiene caracteres no permitidos.');
  }

  return value;
}

function parseServer(value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error('PRIOGLPI_SQL_SERVER es obligatorio.');
  }
  if (value !== value.trim()) {
    throw new Error('PRIOGLPI_SQL_SERVER no debe contener espacios en blanco al inicio o fin.');
  }

  const server = value;
  if (/[\x00-\x1F\x7F]/.test(server) || /[ ,{}:\/\\;=]/.test(server)) {
    throw new Error('PRIOGLPI_SQL_SERVER contiene caracteres prohibidos.');
  }
  if (server.toLowerCase() === 'localhost') {
    throw new Error('PRIOGLPI_SQL_SERVER no puede ser localhost.');
  }

  for (const label of server.split('.')) {
    if (!label || label.startsWith('-') || label.endsWith('-') || !/^[A-Za-z0-9-]+$/.test(label)) {
      throw new Error('PRIOGLPI_SQL_SERVER no es un hostname o FQDN valido.');
    }
  }

  return server;
}

export function parsePrioGlpiSqlConfig(env: PrioGlpiSqlEnv): PrioGlpiSqlConfig {
  if (env.PRIOGLPI_SQL_ODBC_DRIVER !== 'ODBC Driver 18 for SQL Server') {
    throw new Error('PRIOGLPI_SQL_ODBC_DRIVER debe ser ODBC Driver 18 for SQL Server.');
  }
  if (env.PRIOGLPI_SQL_ENCRYPT !== 'true') {
    throw new Error('PRIOGLPI_SQL_ENCRYPT debe ser true.');
  }
  if (
    env.PRIOGLPI_SQL_USER !== undefined ||
    env.PRIOGLPI_SQL_PASSWORD !== undefined ||
    env.PRIOGLPI_SQL_DOMAIN !== undefined
  ) {
    throw new Error('Se prohiben credenciales SQL explicitas; use autenticacion integrada.');
  }

  return {
    server: parseServer(env.PRIOGLPI_SQL_SERVER),
    port: parseStrictInt(env.PRIOGLPI_SQL_PORT, 1, 65535, 'PRIOGLPI_SQL_PORT'),
    database: parseDatabase(env.PRIOGLPI_SQL_DATABASE),
    odbcDriver: 'ODBC Driver 18 for SQL Server',
    encrypt: true,
    trustServerCertificate: parseStrictBoolean(
      env.PRIOGLPI_SQL_TRUST_SERVER_CERTIFICATE,
      'PRIOGLPI_SQL_TRUST_SERVER_CERTIFICATE'
    ),
    connectionTimeoutMs: parseStrictInt(
      env.PRIOGLPI_SQL_CONNECTION_TIMEOUT_MS,
      1000,
      60000,
      'PRIOGLPI_SQL_CONNECTION_TIMEOUT_MS'
    ),
    requestTimeoutMs: parseStrictInt(
      env.PRIOGLPI_SQL_REQUEST_TIMEOUT_MS,
      1000,
      60000,
      'PRIOGLPI_SQL_REQUEST_TIMEOUT_MS'
    ),
    poolMax: parseStrictInt(env.PRIOGLPI_SQL_POOL_MAX, 1, 10, 'PRIOGLPI_SQL_POOL_MAX'),
    trustedConnection: true,
  };
}
