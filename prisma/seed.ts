import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

const runtimeMode = process.env.APPGLPI_RUNTIME_MODE;
if (runtimeMode !== 'qa') {
  console.error('ERROR: APPGLPI_RUNTIME_MODE debe ser "qa"');
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl || !dbUrl.startsWith('file:')) {
  console.error('ERROR: DATABASE_URL debe empezar con "file:"');
  process.exit(1);
}

const dbPathRaw = dbUrl.replace('file:', '');
if (dbPathRaw.includes('?') || dbPathRaw.includes('#')) {
  console.error('ERROR: DATABASE_URL no debe contener querystring ni fragmento.');
  process.exit(1);
}

if (!path.isAbsolute(dbPathRaw)) {
  console.error('ERROR: DATABASE_URL debe ser absoluta.');
  process.exit(1);
}

if (!fs.existsSync(dbPathRaw)) {
  console.error(`ERROR: La base de datos QA no existe en ${dbPathRaw}`);
  process.exit(1);
}

const qaDbReal = fs.realpathSync(dbPathRaw);
const qaDirReal = fs.realpathSync(path.join(process.cwd(), 'data', 'qa'));

const relativePath = path.relative(qaDirReal, qaDbReal);
if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
  console.error(`ERROR: La base de datos escapa del contenedor QA permitido (${qaDirReal}).`);
  process.exit(1);
}

const activeDbPath = path.resolve(process.cwd(), 'data', 'appglpi.sqlite');
if (!fs.existsSync(activeDbPath)) {
  console.error('ERROR: La base productiva data/appglpi.sqlite no existe. Imposible validar protecciÃ³n.');
  process.exit(1);
}

const activeDbReal = fs.realpathSync(activeDbPath);

if (qaDbReal.toLowerCase() === activeDbReal.toLowerCase()) {
  console.error('ERROR: La base QA apunta a la base activa (case-insensitive hit). Abortando.');
  process.exit(1);
}

const qaStat = fs.statSync(qaDbReal);
const activeStat = fs.statSync(activeDbReal);
if (qaStat.dev === activeStat.dev && qaStat.ino === activeStat.ino) {
  console.error('ERROR: La base QA tiene el mismo dev+inodo que la base productiva.');
  process.exit(1);
}

const adapter = new PrismaBetterSqlite3({ url: `file:${qaDbReal}` });
const prisma = new PrismaClient({ adapter });

const SALT_ROUNDS = 12;

interface SeedUser {
  username: string;
  password: string;
  displayName: string;
  role: string;
  glpiUserId: number | null;
  sectors: { sectorName: string; glpiGroupId: number }[];
}

const seedUsers: SeedUser[] = [
  {
    username: 'admin',
    password: 'admin123',
    displayName: 'Administrador',
    role: 'admin',
    glpiUserId: null,
    sectors: [],
  },
  {
    username: 'coordinator_demo',
    password: 'coordinator_demo123',
    displayName: 'Mauro Lopez',
    role: 'coordinador_sistemas',
    glpiUserId: 52,
    sectors: [],
  },
  {
    username: 'julianc',
    password: 'julianc123',
    displayName: 'Julian Cancio',
    role: 'referente',
    glpiUserId: 231,
    sectors: [
      { sectorName: 'Impuestos', glpiGroupId: 15 },
      { sectorName: 'TesorerÃ­a', glpiGroupId: 55 },
      { sectorName: 'Cuentas a Pagar', glpiGroupId: 14 },
      { sectorName: 'RRHH', glpiGroupId: 36 },
    ],
  },
  {
    username: 'carolinar',
    password: 'carolinar123',
    displayName: 'Carolina Estavillo',
    role: 'supervisor',
    glpiUserId: 21,
    sectors: [
      { sectorName: 'Impuestos', glpiGroupId: 15 },
    ],
  },
];

async function main() {
  console.log('ðŸŒ± Sembrando base de datos QA...');

  for (const u of seedUsers) {
    const existing = await prisma.user.findUnique({
      where: { username: u.username },
    });

    if (existing) {
      if (existing.authSource !== 'local') {
        throw new Error(`Abortando: La cuenta existente ${u.username} tiene authSource='${existing.authSource}'. Solo se admite 'local'.`);
      }

      await prisma.user.update({
        where: { username: u.username },
        data: {
          displayName: u.displayName,
          role: u.role,
          glpiUserId: u.glpiUserId,
          isActive: true,
        },
      });
      console.log(`  âœï¸  ${u.username} actualizado (contraseÃ±a preservada)`);

      await prisma.userSectorScope.deleteMany({ where: { userId: existing.id } });
      for (const sector of u.sectors) {
        await prisma.userSectorScope.create({
          data: {
            userId: existing.id,
            sectorName: sector.sectorName,
            glpiGroupId: sector.glpiGroupId,
          },
        });
      }
    } else {
      const passwordHash = await bcrypt.hash(u.password, SALT_ROUNDS);
      const user = await prisma.user.create({
        data: {
          username: u.username,
          passwordHash,
          displayName: u.displayName,
          role: u.role,
          glpiUserId: u.glpiUserId,
          isActive: true,
          authSource: 'local',
        },
      });
      console.log(`  âœ… ${u.username} creado`);

      for (const sector of u.sectors) {
        await prisma.userSectorScope.create({
          data: {
            userId: user.id,
            sectorName: sector.sectorName,
            glpiGroupId: sector.glpiGroupId,
          },
        });
      }
    }
  }

  // System Sync normalizado explÃ­citamente
  const sysUser = await prisma.user.upsert({
    where: { username: 'system_sync' },
    update: {
      role: 'system',
      isActive: false,
      authSource: 'system',
      passwordHash: null,
      glpiUserId: null,
      adObjectId: null,
      email: null,
      directoryActive: null,
      directoryStatusCheckedAt: null
    },
    create: {
      username: 'system_sync',
      displayName: 'Sistema de SincronizaciÃ³n',
      role: 'system',
      isActive: false,
      authSource: 'system',
      passwordHash: null,
      glpiUserId: null,
      adObjectId: null,
      email: null,
      directoryActive: null,
      directoryStatusCheckedAt: null
    }
  });
  await prisma.userSectorScope.deleteMany({ where: { userId: sysUser.id } });
  await prisma.sectorReferentAssignment.deleteMany({ where: { referentUserId: sysUser.id } });

  console.log('âœ… Seed completado.');
}

main()
  .catch((e) => {
    console.error('âŒ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
