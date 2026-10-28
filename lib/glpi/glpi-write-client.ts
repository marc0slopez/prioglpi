/**
 * glpi-write-client.ts
 * Cliente server-side de escritura hacia la API REST de GLPI.
 * Solo se usa desde backend (API routes / servicios). Nunca exponer al frontend.
 *
 * Variables de entorno utilizadas:
 *   GLPI_API_BASE_URL      — URL base (fallback a GLPI_BASE_URL si no está definida)
 *   GLPI_APP_TOKEN         — Token de aplicación GLPI
 *   GLPI_USER_TOKEN        — Token de usuario GLPI
 *   GLPI_FOLLOWUP_APP_TOKEN  — App-Token exclusivo para seguimientos
 *   GLPI_FOLLOWUP_USER_TOKEN — User-Token exclusivo para seguimientos
 *   GLPI_WRITE_ENABLED     — "true" para habilitar escritura
 *   GLPI_WRITE_TIMEOUT_MS  — Timeout en ms (default 10000)
 *   GLPI_ALLOW_SELF_SIGNED — "true" para deshabilitar validación TLS
 *
 * Mapping de dropdown de progreso (opcional):
 *   GLPI_PROGRESS_MAP_0   — ID GLPI para 0%   (si vacío: usa el entero 0)
 *   GLPI_PROGRESS_MAP_25  — ID GLPI para 25%  (si vacío: usa el entero 25)
 *   GLPI_PROGRESS_MAP_50  — ID GLPI para 50%  (si vacío: usa el entero 50)
 *   GLPI_PROGRESS_MAP_75  — ID GLPI para 75%  (si vacío: usa el entero 75)
 *   GLPI_PROGRESS_MAP_100 — ID GLPI para 100% (si vacío: usa el entero 100)
 */

import { Agent, fetch as undiciFetch } from 'undici';

// ─── Configuración desde env ────────────────────────────────────────────────

function getEnvBaseUrl(): string {
  return (process.env.GLPI_API_BASE_URL || process.env.GLPI_BASE_URL || '').replace(/\/$/, '');
}

function getEnvAppToken(): string {
  return process.env.GLPI_APP_TOKEN || '';
}

function getEnvUserToken(): string {
  return process.env.GLPI_USER_TOKEN || '';
}

function getEnvTimeoutMs(): number {
  return parseInt(process.env.GLPI_WRITE_TIMEOUT_MS || '10000', 10);
}

const DEFAULT_PROGRESS_SEARCH_OPT_ID = 76666;

function getProgressSearchOptionId(): number {
  const raw = process.env.GLPI_PROGRESS_SEARCH_OPT_ID;
  const parsed = raw && raw.trim() !== '' ? parseInt(raw.trim(), 10) : DEFAULT_PROGRESS_SEARCH_OPT_ID;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PROGRESS_SEARCH_OPT_ID;
}

export function isGlpiWriteEnabled(): boolean {
  return process.env.GLPI_WRITE_ENABLED === 'true';
}

// ─── Mapping de progreso (entero → ID de dropdown GLPI, si corresponde) ─────

/**
 * Resuelve el valor a enviar para el campo progresodelticketfield.
 * Si GLPI_PROGRESS_MAP_<N> está configurado, usa ese ID de dropdown.
 * De lo contrario, usa el entero directamente.
 */
export function resolveProgressValue(percent: number): number {
  const envKey = `GLPI_PROGRESS_MAP_${percent}` as
    | 'GLPI_PROGRESS_MAP_0'
    | 'GLPI_PROGRESS_MAP_25'
    | 'GLPI_PROGRESS_MAP_50'
    | 'GLPI_PROGRESS_MAP_75'
    | 'GLPI_PROGRESS_MAP_100';
  const raw = process.env[envKey];
  if (raw && raw.trim() !== '') {
    const mapped = parseInt(raw.trim(), 10);
    if (Number.isFinite(mapped) && mapped > 0) {
      return mapped;
    }
  }
  return percent;
}

// ─── Error seguro (sin tokens) ───────────────────────────────────────────────

export class GlpiWriteError extends Error {
  public readonly safeDetail: string;
  constructor(message: string, safeDetail: string) {
    super(message);
    this.name = 'GlpiWriteError';
    this.safeDetail = safeDetail;
  }
}

/**
 * Error específico para el followup cuando falla por permisos u otro motivo
 * no crítico — permite que TPR y avance ya guardados no se reviertan.
 */
export class GlpiFollowupPermissionError extends Error {
  public readonly safeDetail: string;
  constructor(message: string, safeDetail: string) {
    super(message);
    this.name = 'GlpiFollowupPermissionError';
    this.safeDetail = safeDetail;
  }
}

/**
 * Error específico cuando el avance se envía con HTTP 200 pero GLPI no lo procesa
 * o no se puede verificar su actualización.
 */
export class GlpiProgressWarningError extends Error {
  public readonly safeDetail: string;
  constructor(message: string, safeDetail: string) {
    super(message);
    this.name = 'GlpiProgressWarningError';
    this.safeDetail = safeDetail;
  }
}

// ─── Resultado de la operación de escritura completa ─────────────────────────

export interface GlpiWriteResult {
  tprUpdated: boolean;
  progressUpdated: boolean;
  followupCreated: boolean;
  /** Mensaje de advertencia sobre el followup si hubo problema de permisos */
  followupWarning: string | null;
  /** Mensaje de advertencia sobre el avance si no se pudo confirmar */
  progressWarning: string | null;
}

// ─── Sanitización de contenido HTML ─────────────────────────────────────────

function sanitizeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeProgressDisplay(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function progressDisplayMatchesPercent(value: unknown, percent: number): boolean {
  const display = normalizeProgressDisplay(value);
  if (!display) return false;

  const expected = `${percent}%`;
  const lastPart = display.split('>').map(part => part.trim()).filter(Boolean).at(-1) ?? display;

  if (percent === 0) {
    return lastPart.startsWith('0%') || display.startsWith('0%');
  }

  return lastPart === expected || display.includes(`> ${expected}`);
}

// ─── Dispatcher Undici (self-signed opcional) ────────────────────────────────

const glpiWriteDispatcher =
  process.env.GLPI_ALLOW_SELF_SIGNED === 'true'
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;

// ─── Cliente de escritura ────────────────────────────────────────────────────

export class GlpiWriteClient {
  private sessionToken: string | null = null;
  private readonly baseUrl: string;
  private readonly appToken: string;
  private readonly userToken: string;
  private readonly timeoutMs: number;

  private constructor(baseUrl: string, appToken: string, userToken: string, timeoutMs: number) {
    this.baseUrl = baseUrl;
    this.appToken = appToken;
    this.userToken = userToken;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Fábrica que lee las variables de entorno.
   * Lanza GlpiWriteError si faltan configuraciones obligatorias.
   */
  static fromEnv(): GlpiWriteClient {
    const baseUrl = getEnvBaseUrl();
    const appToken = getEnvAppToken();
    const userToken = getEnvUserToken();
    const timeoutMs = getEnvTimeoutMs();

    if (!baseUrl) {
      throw new GlpiWriteError(
        'GLPI_API_BASE_URL/GLPI_BASE_URL no configurado',
        'Configuración GLPI incompleta'
      );
    }
    if (!appToken || !userToken) {
      throw new GlpiWriteError(
        'GLPI_APP_TOKEN o GLPI_USER_TOKEN no configurado',
        'Configuración GLPI incompleta'
      );
    }

    return new GlpiWriteClient(baseUrl, appToken, userToken, timeoutMs);
  }

  static fromFollowupEnv(): GlpiWriteClient {
    const baseUrl = getEnvBaseUrl();
    const appToken = process.env.GLPI_FOLLOWUP_APP_TOKEN?.trim();
    const userToken = process.env.GLPI_FOLLOWUP_USER_TOKEN?.trim();
    if (!baseUrl || !appToken || !userToken) {
      throw new GlpiWriteError(
        'Credenciales de seguimiento GLPI incompletas',
        'Configuración de seguimiento GLPI incompleta'
      );
    }
    return new GlpiWriteClient(baseUrl, appToken, userToken, getEnvTimeoutMs());
  }

  // ─── Sesión ────────────────────────────────────────────────────────────────

  async initSession(): Promise<void> {
    const data = await this.request<{ session_token: string }>('GET', '/initSession', undefined, {
      Authorization: `user_token ${this.userToken}`,
    });
    if (typeof data.session_token !== 'string' || !data.session_token) {
      throw new GlpiWriteError('initSession: session_token inválido', 'Error al iniciar sesión GLPI');
    }
    this.sessionToken = data.session_token;
  }

  async killSession(): Promise<void> {
    if (!this.sessionToken) return;
    try {
      await this.request('GET', '/killSession');
    } catch {
      // Ignorar errores al cerrar sesión — no es crítico
    } finally {
      this.sessionToken = null;
    }
  }

  async getUserLogin(glpiUserId: number): Promise<string> {
    if (!Number.isSafeInteger(glpiUserId) || glpiUserId < 1) {
      throw new GlpiWriteError('ID de usuario GLPI invalido', 'Usuario GLPI invalido');
    }
    const user = await this.request<{ id?: number; name?: string }>('GET', `/User/${glpiUserId}`);
    if (Number(user.id) !== glpiUserId || typeof user.name !== 'string' || !user.name.trim()) {
      throw new GlpiWriteError('GLPI devolvio otro usuario', 'No se pudo verificar el autor en GLPI');
    }
    return user.name.trim();
  }

  // ─── Operaciones de escritura ──────────────────────────────────────────────

  /**
   * Actualiza el campo time_to_resolve (TPR) del ticket en GLPI.
   * @param ticketId ID del ticket
   * @param dateStr  Fecha YYYY-MM-DD (GLPI espera "YYYY-MM-DD HH:MM:SS")
   */
  async updateTicketTpr(ticketId: number, dateStr: string): Promise<void> {
    const timeToResolve = `${dateStr} 00:00:00`;
    await this.request('PUT', `/Ticket/${ticketId}`, {
      input: {
        time_to_resolve: timeToResolve,
      },
    });
  }

  /**
   * Actualiza el campo de avance (plugin_fields) del ticket en GLPI.
   *
   * El valor enviado a GLPI se resuelve mediante resolveProgressValue():
   *   - Si GLPI_PROGRESS_MAP_<N> está configurado: usa ese ID de dropdown.
   *   - Si no:  usa el entero directamente.
   *
   * @param ticketId ID del ticket
   * @param percent  Valor de avance (0, 25, 50, 75, 100)
   */
  async updateTicketProgress(ticketId: number, percent: number): Promise<void> {
    const glpiValue = resolveProgressValue(percent);
    const searchOptId = getProgressSearchOptionId();

    // Si no hay mapping (devuelve el porcentaje original), lanzar advertencia directamente
    // porque sabemos que es un dropdown y requiere IDs internos, no porcentajes.
    if (glpiValue === percent) {
      throw new GlpiProgressWarningError(
        `Falta mapear el ID del dropdown para ${percent}%.`,
        'El avance no pudo confirmarse en GLPI.'
      );
    }

    // Leer ANTES con el search option confirmado del plugin.
    let beforeProgress: unknown = null;
    try {
      beforeProgress = await this.readTicketProgressDisplay(ticketId, searchOptId);
    } catch { /* ignore */ }

    // Escribir con el payload plano confirmado por scripts/glpi-progress-test.mjs.
    // Las variantes _plugin_fields anidadas devuelven HTTP 200, pero GLPI las ignora.
    await this.request('PUT', `/Ticket/${ticketId}`, {
      input: {
        plugin_fields_progresodelticketfielddropdowns_id: glpiValue,
      },
    });

    // Darle una pequeña ventana a GLPI antes de leer el valor de vuelta.
    await new Promise(resolve => setTimeout(resolve, 300));

    // Leer DESPUÉS y validar contra el porcentaje solicitado, no solo contra HTTP 200.
    let afterProgress: unknown = null;
    try {
      afterProgress = await this.readTicketProgressDisplay(ticketId, searchOptId);
    } catch { /* ignore */ }

    if (afterProgress == null) {
      throw new GlpiProgressWarningError(
        `No se pudo verificar el avance en GLPI luego del PUT. Valor previo: ${normalizeProgressDisplay(beforeProgress) || 'sin dato'}.`,
        'El avance no pudo confirmarse en GLPI.'
      );
    }

    if (!progressDisplayMatchesPercent(afterProgress, percent)) {
      throw new GlpiProgressWarningError(
        `El avance enviado (${percent}%, id GLPI ${glpiValue}) no coincide con GLPI. Antes: ${normalizeProgressDisplay(beforeProgress) || 'sin dato'}. Despues: ${normalizeProgressDisplay(afterProgress) || 'sin dato'}.`,
        'El avance no pudo confirmarse en GLPI.'
      );
    }
  }

  private async readTicketProgressDisplay(ticketId: number, searchOptId: number): Promise<unknown> {
    const endpoint =
      `/search/Ticket?criteria[0][field]=2&criteria[0][searchtype]=equals&criteria[0][value]=${ticketId}` +
      `&forcedisplay[0]=${searchOptId}&rawdata=1`;

    const data = await this.request<{ data?: Array<Record<string, unknown>> }>('GET', endpoint);
    const row = Array.isArray(data.data) ? data.data[0] : undefined;
    if (!row) return null;

    const directValue = row[String(searchOptId)];
    if (directValue !== undefined && directValue !== null) return directValue;

    // Algunos GLPI devuelven el forcedisplay con otra clave/alias. Si aparece una
    // ruta de dropdown con porcentajes, sirve igual para confirmar el avance.
    for (const value of Object.values(row)) {
      if (typeof value === 'string' && value.includes('%')) return value;
    }

    return null;
  }

  /**
   * Crea un seguimiento (ITILFollowup) en el ticket de GLPI.
   * Si falla por permisos, lanza GlpiFollowupPermissionError en lugar de GlpiWriteError,
   * para que el caller pueda tratarlo como advertencia en lugar de error bloqueante.
   *
   * @param ticketId  ID del ticket
   * @param content   Texto (se sanitiza HTML)
   * @param isPrivate true => is_private=1, false => is_private=0
   * @param authorGlpiUserId ID de GLPI obtenido del usuario autenticado en el servidor
   */
  async createFollowup(ticketId: number, content: string, isPrivate: boolean, authorGlpiUserId?: number): Promise<void> {
    if (authorGlpiUserId !== undefined && (!Number.isSafeInteger(authorGlpiUserId) || authorGlpiUserId < 1)) {
      throw new GlpiWriteError('ID de autor GLPI invalido', 'Autor GLPI invalido');
    }
    const safeContent = sanitizeHtml(content);
    const payload = {
      input: {
        itemtype: 'Ticket',
        items_id: ticketId,
        content: safeContent,
        is_private: isPrivate ? 1 : 0,
        ...(authorGlpiUserId !== undefined ? { users_id: authorGlpiUserId } : {}),
      },
    };

    try {
      await this.request('POST', '/ITILFollowup', payload);
    } catch (err) {
      if (err instanceof GlpiWriteError) {
        // Extraer mensaje del JSON devuelto por GLPI si existe (ej: ["ERROR_GLPI_ADD", "No tiene permisos para realizar esta acción."])
        let glpiReason = 'Error desconocido de GLPI';
        try {
          const match = err.safeDetail.match(/\[.*?\]/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (Array.isArray(parsed) && parsed.length >= 2) {
              glpiReason = parsed[1]; // el segundo elemento suele ser el mensaje legible
            } else if (Array.isArray(parsed) && parsed.length === 1) {
              glpiReason = parsed[0];
            } else {
              glpiReason = match[0];
            }
          } else {
            // Si no es un JSON o array, tratar de mostrar algo útil
            const cleanMessage = err.safeDetail.split(': ').slice(1).join(': ') || err.safeDetail;
            glpiReason = cleanMessage.slice(0, 80);
          }
        } catch {
          // Si falla el parseo, mostrar parte del string limpio
          glpiReason = err.safeDetail.slice(0, 80);
        }

        // Convertimos cualquier error de seguimiento a advertencia
        // para no bloquear TPR/avance que ya fueron enviados correctamente
        throw new GlpiFollowupPermissionError(
          `Followup falló: ${err.message}`,
          `GLPI rechazó el seguimiento: ${glpiReason}`
        );
      }
      // Cualquier otro error de red / inesperado
      throw new GlpiFollowupPermissionError(
        `Followup falló: ${err instanceof Error ? err.message : String(err)}`,
        'Error de red al intentar crear el seguimiento en GLPI'
      );
    }
  }

  // ─── HTTP interno ──────────────────────────────────────────────────────────

  private async request<T = unknown>(
    method: 'GET' | 'PUT' | 'POST',
    endpoint: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'App-Token': this.appToken,
      ...extraHeaders,
    };

    if (this.sessionToken) {
      headers['Session-Token'] = this.sessionToken;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const fetchOptions: Parameters<typeof undiciFetch>[1] = {
        method,
        headers,
        signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(glpiWriteDispatcher ? { dispatcher: glpiWriteDispatcher } : {}),
      };

      const response = await undiciFetch(url, fetchOptions);

      if (!response.ok) {
        const rawBody = await response.text().catch(() => '');
        // Truncar y limpiar tokens antes de incluir en el error
        const safeBody = rawBody.slice(0, 300)
          .replace(/token[^"]*"[^"]*"/gi, 'token="***"')
          .replace(/(App-Token|Session-Token|user_token)\s*[:\s]+\S+/gi, '$1 ***');
        throw new GlpiWriteError(
          `GLPI API ${method} ${endpoint}: HTTP ${response.status}`,
          `Error GLPI HTTP ${response.status} en ${endpoint.split('?')[0]}: ${safeBody}`
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }
      return {} as T;
    } catch (err) {
      if (err instanceof GlpiWriteError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new GlpiWriteError(
          `GLPI request timeout (${this.timeoutMs}ms) en ${endpoint}`,
          `Timeout al conectar con GLPI (${this.timeoutMs}ms)`
        );
      }
      throw new GlpiWriteError(
        `GLPI request error en ${endpoint}`,
        'Error de conexión con GLPI'
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
