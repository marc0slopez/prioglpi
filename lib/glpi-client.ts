import { Agent, fetch as undiciFetch } from 'undici';
import { parseGlpiProgress } from './glpi-progress';

const GLPI_BASE_URL = process.env.GLPI_BASE_URL || '';
const GLPI_APP_TOKEN = process.env.GLPI_APP_TOKEN || '';
const GLPI_USER_TOKEN = process.env.GLPI_USER_TOKEN || '';
const GLPI_TIMEOUT_MS = parseInt(process.env.GLPI_TIMEOUT_MS || '30000', 10);
const GLPI_ALLOW_SELF_SIGNED = process.env.GLPI_ALLOW_SELF_SIGNED === 'true';
const GLPI_WEB_URL = process.env.GLPI_WEB_URL || '';

// Dispatcher Undici acotado para GLPI con soporte self-signed
const glpiDispatcher = GLPI_ALLOW_SELF_SIGNED
  ? new Agent({ connect: { rejectUnauthorized: false } })
  : undefined;

interface GlpiSession {
  session_token: string;
}

export class GlpiClient {
  private sessionToken: string | null = null;

  async initSession(): Promise<string> {
    const response = await this.glpiGet<GlpiSession>('/initSession', {
      'Authorization': `user_token ${GLPI_USER_TOKEN}`,
    });
    this.sessionToken = response.data.session_token;
    return this.sessionToken;
  }

  async killSession(): Promise<void> {
    if (!this.sessionToken) return;
    try {
      await this.glpiGet('/killSession');
    } catch {
      // Ignorar errores al cerrar sesión
    }
    this.sessionToken = null;
  }

  getTicketWebUrl(ticketId: number): string {
    return `${GLPI_WEB_URL}/front/ticket.form.php?id=${ticketId}`;
  }

  async getTicketListSnapshots(ticketIds: readonly number[]): Promise<Map<number, GlpiTicketListSnapshot>> {
    if (!this.sessionToken) throw new Error('GLPI session is not initialized');
    const ids = [...new Set(ticketIds)];
    if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Invalid ticket ID');

    const snapshots = new Map<number, GlpiTicketListSnapshot>();
    const progressField = process.env.GLPI_PROGRESS_SEARCH_FIELD || '76666';
    if (!/^\d+$/.test(progressField)) throw new Error('Invalid GLPI progress search field');

    for (let start = 0; start < ids.length; start += 25) {
      const batch = ids.slice(start, start + 25);
      const params = new URLSearchParams();
      batch.forEach((id, index) => {
        if (index > 0) params.set(`criteria[${index}][link]`, 'OR');
        params.set(`criteria[${index}][field]`, '2');
        params.set(`criteria[${index}][searchtype]`, 'equals');
        params.set(`criteria[${index}][value]`, String(id));
      });
      params.set('forcedisplay[0]', '2');
      params.set('forcedisplay[1]', '18');
      params.set('forcedisplay[2]', progressField);
      params.set('range', `0-${batch.length - 1}`);

      const response = await this.glpiGet<{ data?: Record<string, unknown>[] }>(`/search/Ticket?${params}`);
      if (!Array.isArray(response.data.data)) throw new Error('Invalid GLPI ticket search response');
      const batchIds = new Set(batch);
      for (const row of response.data.data) {
        const id = Number(row['2']);
        if (!batchIds.has(id) || snapshots.has(id)) throw new Error('Unexpected GLPI ticket search result');
        snapshots.set(id, {
          progressPercent: parseGlpiProgress(row[progressField]),
          timeToResolve: typeof row['18'] === 'string' && row['18'].trim() ? row['18'] : null,
        });
      }
    }
    return snapshots;
  }

  /**
   * Obtiene todos los registros de un endpoint usando paginación.
   */
  async getAll<T extends { id?: number }>(endpoint: string, expandDropdowns = false, limitParam = 500) {
    const allData: T[] = [];
    let reportedTotal = 0;
    let offset = 0;
    let pages = 0;
    let exhausted = false;

    const baseEndpoint = endpoint.split('?')[0];
    const isUserEndpoint = baseEndpoint === '/User' || baseEndpoint === '/User/';

    while (true) {
      const range = `${offset}-${offset + limitParam - 1}`;
      const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}range=${range}${expandDropdowns ? '&expand_dropdowns=true' : ''}`;

      let res;
      try {
        res = await this.glpiGet<T[]>(url);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('416') || errMsg.includes('Range')) {
          exhausted = true;
          break; // Fin de resultados
        }
        throw err;
      }

      pages++;
      const chunk = res.data;
      if (!Array.isArray(chunk)) {
        throw new Error(`Expected array but got ${typeof chunk} from ${url}`);
      }

      allData.push(...chunk);

      if (res.contentRange) {
        const match = res.contentRange.match(/\/(\d+)$/);
        if (match && match[1]) {
          reportedTotal = parseInt(match[1], 10);
        }
      }

      if (chunk.length === 0) {
        exhausted = true;
        break;
      }

      if (res.contentRange) {
        const match = res.contentRange.match(/\/(\d+)$/);
        if (match && match[1]) {
          const total = parseInt(match[1], 10);
          if (offset + limitParam >= total) {
            exhausted = true;
            break;
          }
        }
      }

      offset += limitParam;
    }

    const downloadedTotal = allData.length;

    if (!isUserEndpoint && reportedTotal > 0 && downloadedTotal !== reportedTotal) {
      throw new Error(`Mismatch in ${endpoint}: downloaded ${downloadedTotal} vs reported ${reportedTotal}`);
    }

    const ids = allData.map(i => i.id);
    const invalidIds = ids.filter(id => typeof id !== 'number' || isNaN(id));
    if (invalidIds.length > 0) {
      throw new Error(`Endpoint ${endpoint} returned ${invalidIds.length} items with non-numeric IDs`);
    }

    const uniqueIds = new Set(ids);
    if (ids.length !== uniqueIds.size) {
      throw new Error(`Endpoint ${endpoint} returned duplicate IDs`);
    }

    return {
      data: allData,
      reportedTotal,
      downloadedTotal,
      pages,
      exhausted
    };
  }

  async fetchSearchIds(urlBase: string, limitParam = 500): Promise<number[]> {
    const allIds: number[] = [];
    let offset = 0;
    let reportedTotal = 0;

    while (true) {
      const url = `${urlBase}&range=${offset}-${offset + limitParam - 1}`;
      let res;
      try {
        res = await this.glpiGet<{ data?: Array<Record<string, string>> }>(url);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('416') || errMsg.includes('Range')) {
          break;
        }
        throw err;
      }

      if (res.totalCount > 0) {
        reportedTotal = res.totalCount;
      }

      const body = res.data;
      if (!body) {
         throw new Error(`fetchSearchIds: respuesta malformada, falta body en ${url}`);
      }
      if (!Array.isArray(body.data)) {
         throw new Error(`fetchSearchIds: body.data no es un array en ${url}`);
      }

      const chunkIds = body.data.map(d => parseInt(d['2'], 10));
      for (const id of chunkIds) {
        if (typeof id !== 'number' || !Number.isFinite(id) || isNaN(id)) {
          throw new Error(`fetchSearchIds: ID inválido detectado (${id}) en ${url}`);
        }
      }

      allIds.push(...chunkIds);

      if (body.data.length === 0) {
        break;
      }

      if (body.data.length < limitParam || offset + limitParam >= (res.totalCount || 0)) {
        break;
      }
      offset += limitParam;
    }

    if (reportedTotal > 0 && allIds.length !== reportedTotal) {
      throw new Error(`fetchSearchIds: Mismatch en total: descargados ${allIds.length} vs reportados ${reportedTotal}`);
    }

    const uniqueIds = new Set(allIds);
    if (uniqueIds.size !== allIds.length) {
      throw new Error(`fetchSearchIds: Se detectaron IDs duplicados`);
    }

    return allIds;
  }

  /**
   * Método GET genérico contra la API de GLPI.
   */
  private async glpiGet<T>(
    endpoint: string,
    extraHeaders?: Record<string, string>
  ): Promise<{ data: T; totalCount: number; contentRange: string | null }> {
    const url = `${GLPI_BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'App-Token': GLPI_APP_TOKEN,
      ...extraHeaders,
    };

    if (this.sessionToken) {
      headers['Session-Token'] = this.sessionToken;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GLPI_TIMEOUT_MS);

    try {
      const fetchOptions: Parameters<typeof undiciFetch>[1] = {
        method: 'GET',
        headers,
        signal: controller.signal,
        ...(glpiDispatcher ? { dispatcher: glpiDispatcher } : {}),
      };

      const response = await undiciFetch(url, fetchOptions);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'No body');
        throw new GlpiApiError(
          `GLPI API error: ${response.status} ${response.statusText}`,
          response.status,
          errorBody
        );
      }

      const contentRange = response.headers.get('content-range');
      let totalCount = 0;
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match && match[1]) {
          totalCount = parseInt(match[1], 10);
        }
      }

      const data = (await response.json()) as T;
      return { data, totalCount, contentRange };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface GlpiTicketListSnapshot {
  progressPercent: number | null;
  timeToResolve: string | null;
}


export class GlpiApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody: string
  ) {
    super(message);
    this.name = 'GlpiApiError';
  }
}

// Tipos GLPI
export interface GlpiGroup {
  id: number;
  name: string;
  completename?: string;
  entities_id?: number;
  is_recursive?: number;
  sons_cache?: string;
  groups_id?: number;
  level?: number;
  comment?: string;
}

export interface GlpiTicket {
  id: number;
  name: string;
  content: string;
  status: number;
  type: number;
  priority: number;
  date: string;
  date_mod: string;
  solvedate?: string;
  closedate?: string;
  locations_id?: number;
  entities_id?: number;
  itilcategories_id?: number;
  requesttypes_id?: number;
  urgency?: number;
  impact?: number;
  [key: string]: unknown;
}

export interface GlpiTicketUser {
  id: number;
  tickets_id: number;
  users_id: number;
  type: number; // 1=requester, 2=assigned, 3=observer
}

export interface GlpiGroupTicket {
  id: number;
  tickets_id: number;
  groups_id: number;
  type: number; // 1=requester, 2=assigned, 3=observer
}

export interface GlpiFollowup {
  id: number;
  items_id: number; // is ticketId
  content: string;
  date: string;
  date_mod: string;
  users_id: number;
  is_private?: number;
}

export interface GlpiTask {
  id: number;
  tickets_id: number;
  content: string;
  date: string;
  date_mod: string;
  users_id: number;
  state: number;
  is_private?: number;
  users_id_tech?: number;
  groups_id_tech?: number;
}

export interface GlpiUser {
  id: number;
  name: string;
  realname?: string;
  firstname?: string;
  email?: string;
  groups_id?: number;
  is_active?: number;
}

export interface GlpiGroupUser {
  id: number;
  users_id: number;
  groups_id: number;
  is_manager: number;
  is_dynamic: number;
}

export interface GlpiITILCategory {
  id: number;
  name: string;
  completename?: string;
}

export interface GlpiLocation {
  id: number;
  name: string;
  completename?: string;
}

export interface GlpiRequestType {
  id: number;
  name: string;
}

export interface GlpiEntity {
  id: number;
  name: string;
  completename?: string;
}

// Mapeo de estados GLPI
export const GLPI_STATUS_MAP: Record<number, string> = {
  1: 'Nuevo',
  2: 'En curso',
  3: 'Planificado',
  4: 'En espera',
  5: 'Resuelto',
  6: 'Cerrado',
};

export const EXCLUDED_STATUS_IDS = [5, 6];
export const SISTEMAS_GROUP_ID = 30;
export const TECNOLOGIA_GROUP_ID = 32;
