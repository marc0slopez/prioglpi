/**
 * Database Audit Script
 * Verifies integrity, schema, indexes, counts, and foreign keys.
 * Usage: npx tsx scripts/audit-db.ts [path-to-sqlite]
 */
import 'dotenv/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const Database = require('better-sqlite3') as any;
import * as path from 'path';
import * as fs from 'fs';

const dbPath = process.argv[2] || path.resolve(__dirname, '../data/appglpi.sqlite');

if (!fs.existsSync(dbPath)) {
  console.error(`❌ Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

console.log('='.repeat(70));
console.log('APPGLPI v3 — Database Audit');
console.log('='.repeat(70));
console.log(`File: ${dbPath}`);
console.log(`Size: ${fs.statSync(dbPath).size} bytes`);
console.log('');

// 1. PRAGMA integrity_check
console.log('── PRAGMA integrity_check ──');
const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
for (const row of integrity) {
  console.log(`  ${row.integrity_check}`);
}
console.log('');

// 2. List all tables
console.log('── Tables ──');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
for (const t of tables) {
  console.log(`  ${t.name}`);
}
console.log('');

// 3. For each table: table_info, count, indexes, foreign_keys
for (const t of tables) {
  const name = t.name;
  console.log(`── Table: ${name} ──`);

  // Count
  const countRow = db.prepare(`SELECT count(*) as cnt FROM "${name}"`).get() as { cnt: number };
  console.log(`  Count: ${countRow.cnt}`);

  // PRAGMA table_info
  const columns = db.pragma(`table_info("${name}")`) as Array<{
    cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number;
  }>;
  console.log(`  Columns (${columns.length}):`);
  for (const col of columns) {
    const flags = [];
    if (col.pk) flags.push('PK');
    if (col.notnull) flags.push('NOT NULL');
    if (col.dflt_value !== null) flags.push(`DEFAULT=${col.dflt_value}`);
    console.log(`    ${col.name} ${col.type} ${flags.join(' ')}`);
  }

  // PRAGMA index_list
  const indexes = db.pragma(`index_list("${name}")`) as Array<{
    seq: number; name: string; unique: number; origin: string;
  }>;
  if (indexes.length > 0) {
    console.log(`  Indexes (${indexes.length}):`);
    for (const idx of indexes) {
      const idxCols = db.pragma(`index_info("${idx.name}")`) as Array<{ seqno: number; cid: number; name: string }>;
      const colNames = idxCols.map(c => c.name).join(', ');
      console.log(`    ${idx.name} [${idx.unique ? 'UNIQUE' : 'INDEX'}] (${colNames})`);
    }
  }

  // PRAGMA foreign_key_list
  const fks = db.pragma(`foreign_key_list("${name}")`) as Array<{
    id: number; seq: number; table: string; from: string; to: string;
  }>;
  if (fks.length > 0) {
    console.log(`  Foreign Keys (${fks.length}):`);
    for (const fk of fks) {
      console.log(`    ${fk.from} → ${fk.table}(${fk.to})`);
    }
  }

  console.log('');
}

// 4. Summary of critical counts
console.log('── Critical Counts Summary ──');
const criticalTables = [
  'User', 'UserSectorScope', 'GlpiTicketCache', 'TicketRanking',
  'TicketCoordination', 'AuditLog', 'SyncRun',
  'GlpiGroupCache', 'GlpiUserCache', 'GlpiUserGroupMembership',
  'GlpiTicketGroupActor', 'GlpiTicketUserActor',
  'GlpiFollowupCache', 'GlpiTaskCache'
];
for (const name of criticalTables) {
  try {
    const row = db.prepare(`SELECT count(*) as cnt FROM "${name}"`).get() as { cnt: number };
    console.log(`  ${name}: ${row.cnt}`);
  } catch {
    console.log(`  ${name}: TABLE NOT FOUND`);
  }
}

// 5. Check isSistemasScope / isTecnologiaScope distribution
console.log('');
console.log('── Scope Distribution ──');
try {
  const sistemas = db.prepare("SELECT count(*) as cnt FROM GlpiTicketCache WHERE isSistemasScope = 1").get() as { cnt: number };
  const tecnologia = db.prepare("SELECT count(*) as cnt FROM GlpiTicketCache WHERE isTecnologiaScope = 1").get() as { cnt: number };
  const neither = db.prepare("SELECT count(*) as cnt FROM GlpiTicketCache WHERE isSistemasScope = 0 AND isTecnologiaScope = 0").get() as { cnt: number };
  console.log(`  isSistemasScope=true: ${sistemas.cnt}`);
  console.log(`  isTecnologiaScope=true: ${tecnologia.cnt}`);
  console.log(`  Neither: ${neither.cnt}`);
} catch (e) {
  console.log(`  Error: ${e}`);
}

// 6. Check User details
console.log('');
console.log('── Users ──');
try {
  const users = db.prepare("SELECT id, username, displayName, role, glpiUserId FROM User").all() as Array<{
    id: number; username: string; displayName: string; role: string; glpiUserId: number | null;
  }>;
  for (const u of users) {
    console.log(`  id=${u.id} username=${u.username} displayName="${u.displayName}" role=${u.role} glpiUserId=${u.glpiUserId}`);
  }
} catch (e) {
  console.log(`  Error: ${e}`);
}

// 7. Check UserSectorScope
console.log('');
console.log('── UserSectorScope ──');
try {
  const scopes = db.prepare("SELECT id, userId, sectorName, glpiGroupId FROM UserSectorScope").all() as Array<{
    id: number; userId: number; sectorName: string; glpiGroupId: number | null;
  }>;
  for (const s of scopes) {
    console.log(`  userId=${s.userId} sector="${s.sectorName}" glpiGroupId=${s.glpiGroupId}`);
  }
} catch (e) {
  console.log(`  Error: ${e}`);
}

// 8. Check SyncRun history
console.log('');
console.log('── SyncRun History ──');
try {
  const runs = db.prepare("SELECT id, status, ticketsFetched, sistemasCount, tecnologiaCount, errorMessage FROM SyncRun ORDER BY id DESC LIMIT 6").all() as Array<{
    id: number; status: string; ticketsFetched: number; sistemasCount: number; tecnologiaCount: number; errorMessage: string | null;
  }>;
  for (const r of runs) {
    console.log(`  id=${r.id} status=${r.status} tickets=${r.ticketsFetched} sistemas=${r.sistemasCount} tecnologia=${r.tecnologiaCount} error=${r.errorMessage || 'none'}`);
  }
} catch (e) {
  console.log(`  Error: ${e}`);
}

// 9. Check ticket 1089
console.log('');
console.log('── Ticket 1089 ──');
try {
  const t = db.prepare("SELECT ticketId, title, isSistemasScope, isTecnologiaScope, requesterUserId, detectedSectorGroupId, detectedSectorName, sectorSource FROM GlpiTicketCache WHERE ticketId = 1089").get() as {
    ticketId: number; title: string; isSistemasScope: number; isTecnologiaScope: number; requesterUserId: number | null;
    detectedSectorGroupId: number | null; detectedSectorName: string | null; sectorSource: string | null;
  } | undefined;
  if (t) {
    console.log(`  Found: ticketId=${t.ticketId} isSistemas=${t.isSistemasScope} isTecnologia=${t.isTecnologiaScope}`);
    console.log(`  requesterUserId=${t.requesterUserId} sector=${t.detectedSectorName} sectorGroupId=${t.detectedSectorGroupId} sectorSource=${t.sectorSource}`);
  } else {
    console.log('  NOT FOUND');
  }
} catch (e) {
  console.log(`  Error: ${e}`);
}

// 10. Check Group_Ticket actor types for ticket 1089
console.log('');
console.log('── Ticket 1089 Group Actors ──');
try {
  const actors = db.prepare("SELECT id, ticketId, groupId, actorType FROM GlpiTicketGroupActor WHERE ticketId = 1089").all() as Array<{
    id: number; ticketId: number; groupId: number; actorType: number;
  }>;
  for (const a of actors) {
    const typeLabel = a.actorType === 1 ? 'solicitante' : a.actorType === 2 ? 'técnico' : a.actorType === 3 ? 'observación' : `unknown(${a.actorType})`;
    console.log(`  groupId=${a.groupId} type=${a.actorType} (${typeLabel})`);
  }
} catch (e) {
  console.log(`  Error: ${e}`);
}

console.log('');
console.log('── Ticket 1089 User Actors ──');
try {
  const actors = db.prepare("SELECT id, ticketId, glpiUserId, actorType FROM GlpiTicketUserActor WHERE ticketId = 1089").all() as Array<{
    id: number; ticketId: number; glpiUserId: number; actorType: number;
  }>;
  for (const a of actors) {
    const typeLabel = a.actorType === 1 ? 'solicitante' : a.actorType === 2 ? 'técnico' : a.actorType === 3 ? 'observador' : `unknown(${a.actorType})`;
    console.log(`  glpiUserId=${a.glpiUserId} type=${a.actorType} (${typeLabel})`);
  }
} catch (e) {
  console.log(`  Error: ${e}`);
}

db.close();
console.log('');
console.log('='.repeat(70));
console.log('Audit complete.');
console.log('='.repeat(70));
