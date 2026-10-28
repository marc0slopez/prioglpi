import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';
import fs from 'fs';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const isQA = process.env.APPGLPI_RUNTIME_MODE === 'qa';

  if (isQA) {
    if (!process.env.DATABASE_URL) {
      throw new Error("ERROR [QA MODE]: DATABASE_URL es obligatoria. No se permite fallback.");
    }

    let dbPath = process.env.DATABASE_URL;
    if (dbPath.startsWith('file:')) {
      dbPath = dbPath.slice(5);
    }

    if (!path.isAbsolute(dbPath)) {
      throw new Error("ERROR [QA MODE]: DATABASE_URL debe contener una ruta absoluta.");
    }

    const absoluteQaPath = path.resolve(dbPath);
    const activeDbPath = path.resolve(process.cwd(), 'data', 'appglpi.sqlite');

    if (!fs.existsSync(absoluteQaPath)) {
      throw new Error(`ERROR [QA MODE]: La base de datos QA no existe en la ruta: ${absoluteQaPath}`);
    }

    const qaRoot = path.resolve(process.cwd(), 'data', 'qa');
    const relativeToQa = path.relative(qaRoot, absoluteQaPath);

    if (relativeToQa.startsWith('..') || path.isAbsolute(relativeToQa)) {
      throw new Error(`ERROR [QA MODE]: La base de datos QA debe estar dentro de data/qa/. Ruta resuelta: ${absoluteQaPath}`);
    }

    if (absoluteQaPath.toLowerCase() === activeDbPath.toLowerCase()) {
      throw new Error(`ERROR CRÍTICO [QA MODE]: La ruta de QA coincide exactamente con la base activa. Abortando conexión.`);
    }

    console.log(`[PRISMA INIT] databaseMode=qa`);
    console.log(`[PRISMA INIT] databaseFile=${path.basename(absoluteQaPath)}`);

    const adapter = new PrismaBetterSqlite3({ url: `file:${absoluteQaPath}` });
    return new PrismaClient({ adapter });
  }

  // Normal local mode
  const dbUrl = process.env.DATABASE_URL || 'file:./data/appglpi.sqlite';
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
