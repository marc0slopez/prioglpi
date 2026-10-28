const SENSITIVE_KEYS = /^(password|passwordHash|LDAP_BIND_PASSWORD|GLPI_APP_TOKEN|GLPI_USER_TOKEN|JWT_SECRET|token|access_token|refresh_token|client_secret|authorization|proxy-authorization|cookie|set-cookie|bindCredentials|apiKey|sessionToken)$/i;

export function redactSecrets(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    return data
      .replace(/(password|secret|token|apiKey|access_token)=([^&\s]+)/gi, '$1=***REDACTED***')
      .replace(/((?:bearer|basic)\s+)[a-z0-9\-_=\.]+/gi, '$1***REDACTED***');
  }
  if (Array.isArray(data)) {
    return data.map(redactSecrets);
  }
  if (typeof data === 'object') {
    const cleanObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(key)) {
        cleanObj[key] = '***REDACTED***';
      } else {
        cleanObj[key] = redactSecrets(value);
      }
    }
    return cleanObj;
  }
  return data;
}

export function safeParseJson(jsonStr: string | null | undefined): unknown {
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    return redactSecrets(parsed);
  } catch {
    return redactSecrets({ rawContent: jsonStr, _corruptedJson: true });
  }
}
