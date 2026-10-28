import type { ISqlServerRuntime } from './sqlserver-runtime-contract';
import { SqlServerRuntime } from './sqlserver-runtime';
import { MsNodeSqlV8RuntimeDriver } from './msnodesqlv8-runtime-driver';
import { parsePrioGlpiSqlConfig } from '../config/prioglpi-sql-config';

let sharedRuntime: ISqlServerRuntime | null = null;

export function getSharedSqlServerRuntime(): ISqlServerRuntime {
  if (!sharedRuntime) {
    const config = parsePrioGlpiSqlConfig(process.env);
    sharedRuntime = new SqlServerRuntime(config, new MsNodeSqlV8RuntimeDriver());
  }

  return sharedRuntime;
}
