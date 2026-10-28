import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./data/appglpi.sqlite' });
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = await prisma.user.count();
  const tickets = await prisma.glpiTicketCache.count();
  const rankings = await prisma.ticketRanking.count();
  const coordinations = await prisma.ticketCoordination.count();
  const syncRuns = await prisma.syncRun.count();
  const auditLogs = await prisma.auditLog.count();
  const scopes = await prisma.userSectorScope.count();
  console.log(JSON.stringify({ users, scopes, tickets, rankings, coordinations, syncRuns, auditLogs }, null, 2));
  await prisma.$disconnect();
}

main();
