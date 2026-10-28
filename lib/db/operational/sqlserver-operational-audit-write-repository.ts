import type { ISqlServerTransaction, SqlParameter } from '../sqlserver-runtime-contract';
import { CANONICAL_ACTIONS, CANONICAL_ENTITY_TYPES, type CanonicalAction, type CanonicalEntityType } from '../../audit-types';
import { redactSecrets } from '../../secret-sanitizer';
import { OperationalAuditWriteError, type IOperationalAuditWriteRepository } from './operational-audit-write-repository';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalAction(value: unknown): value is CanonicalAction {
  return typeof value === 'string' && CANONICAL_ACTIONS.some((a) => a === value);
}

function isCanonicalEntityType(value: unknown): value is CanonicalEntityType {
  return typeof value === 'string' && CANONICAL_ENTITY_TYPES.some((e) => e === value);
}

function isValidStringField(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.trim().length === 0) return false;
  if (value.length > 255) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 31 || c === 127) return false;
  }
  return true;
}

function validatePayloadTree(node: unknown, seen: Set<object>): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'number') {
    if (Number.isNaN(node) || !Number.isFinite(node)) {
      throw new Error('NaN or Infinity');
    }
    return;
  }
  if (typeof node === 'boolean' || typeof node === 'string') return;
  if (typeof node === 'bigint' || typeof node === 'function' || typeof node === 'symbol') {
    throw new Error('Invalid type');
  }
  if (typeof node === 'object') {
    if (seen.has(node)) throw new Error('Cyclic');
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        validatePayloadTree(node[i], seen);
      }
    } else {
      const entries = Object.entries(node);
      for (let i = 0; i < entries.length; i++) {
        const pair = entries[i];
        if (pair !== undefined) {
          validatePayloadTree(pair[1], seen);
        }
      }
    }
    seen.delete(node);
  }
}

function parsePayloadJson(payload: unknown): string | null {
  if (payload === null || payload === undefined) {
    return null;
  }
  try {
    validatePayloadTree(payload, new Set<object>());
    const redacted = redactSecrets(payload);
    const json = JSON.stringify(redacted);
    if (typeof json !== 'string') {
      throw new Error('JSON.stringify returned non-string');
    }
    return json;
  } catch {
    throw new OperationalAuditWriteError('invalid_input', 'Invalid audit payload');
  }
}

export class SqlServerOperationalAuditWriteRepository implements IOperationalAuditWriteRepository {
  /**
   * tx debe provenir de ISqlServerRuntime.withTransaction.
   * El repositorio no abre/cierra transacciones.
   * La auditoría solo es atómica si comparte exactamente la misma instancia tx que la mutación de negocio.
   * No utilizar con una sesión global.
   */
  constructor(private readonly tx: ISqlServerTransaction) {}

  async writeAudit(input: unknown): Promise<void> {
    if (!isRecord(input)) {
      throw new OperationalAuditWriteError('invalid_input', 'Invalid input type');
    }

    const keys = Reflect.ownKeys(input);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (typeof key !== 'string') {
        throw new OperationalAuditWriteError('invalid_input', 'Additional keys not allowed');
      }
      if (
        key !== 'userId' &&
        key !== 'action' &&
        key !== 'entityType' &&
        key !== 'entityId' &&
        key !== 'before' &&
        key !== 'after' &&
        key !== 'actorName' &&
        key !== 'actorUsername'
      ) {
        throw new OperationalAuditWriteError('invalid_input', 'Additional keys not allowed');
      }
    }

    if (
      !Object.prototype.hasOwnProperty.call(input, 'userId') ||
      !Object.prototype.hasOwnProperty.call(input, 'action') ||
      !Object.prototype.hasOwnProperty.call(input, 'entityType') ||
      !Object.prototype.hasOwnProperty.call(input, 'entityId') ||
      !Object.prototype.hasOwnProperty.call(input, 'actorName') ||
      !Object.prototype.hasOwnProperty.call(input, 'actorUsername')
    ) {
      throw new OperationalAuditWriteError('invalid_input', 'Missing required keys');
    }

    const {
      userId, action, entityType, entityId, before, after, actorName, actorUsername
    } = input;

    if (userId !== null) {
      if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId < 1 || userId > 2147483647) {
        throw new OperationalAuditWriteError('invalid_input', 'Invalid userId');
      }
      if (!isValidStringField(actorName)) {
        throw new OperationalAuditWriteError('invalid_input', 'Invalid actorName for known user');
      }
      if (!isValidStringField(actorUsername)) {
        throw new OperationalAuditWriteError('invalid_input', 'Invalid actorUsername for known user');
      }
    } else {
      if (actorName !== null) {
        throw new OperationalAuditWriteError('invalid_input', 'actorName must be null for anonymous user');
      }
      if (actorUsername !== null && !isValidStringField(actorUsername)) {
        throw new OperationalAuditWriteError('invalid_input', 'Invalid actorUsername for anonymous user');
      }
    }

    if (!isCanonicalAction(action)) {
      throw new OperationalAuditWriteError('invalid_input', 'Invalid action');
    }

    if (!isCanonicalEntityType(entityType)) {
      throw new OperationalAuditWriteError('invalid_input', 'Invalid entityType');
    }

    if (!isValidStringField(entityId)) {
      throw new OperationalAuditWriteError('invalid_input', 'Invalid entityId');
    }

    const beforeJson = parsePayloadJson(before);
    const afterJson = parsePayloadJson(after);

    const sql = `
      INSERT INTO [prioglpi].[audit_log] (
        [user_id],
        [action],
        [entity_type],
        [entity_id],
        [before_json],
        [after_json],
        [actor_name],
        [actor_username]
      )
      VALUES (
        @userId,
        @action,
        @entityType,
        @entityId,
        @beforeJson,
        @afterJson,
        @actorName,
        @actorUsername
      );
    `;

    const params: SqlParameter[] = [
      { name: 'userId', type: 'int', nullable: true, value: userId },
      { name: 'action', type: 'nvarchar', length: 255, nullable: false, value: action },
      { name: 'entityType', type: 'nvarchar', length: 255, nullable: false, value: entityType },
      { name: 'entityId', type: 'nvarchar', length: 255, nullable: false, value: entityId },
      { name: 'beforeJson', type: 'nvarchar', length: 'MAX', nullable: true, value: beforeJson },
      { name: 'afterJson', type: 'nvarchar', length: 'MAX', nullable: true, value: afterJson },
      { name: 'actorName', type: 'nvarchar', length: 255, nullable: true, value: actorName },
      { name: 'actorUsername', type: 'nvarchar', length: 255, nullable: true, value: actorUsername }
    ];

    const rowsAffected = await this.tx.execute(sql, params);

    if (typeof rowsAffected !== 'number' || !Number.isSafeInteger(rowsAffected) || rowsAffected !== 1) {
      throw new OperationalAuditWriteError('unexpected_result', 'Unexpected audit insert result');
    }
  }
}
