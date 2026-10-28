import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import * as bcrypt from 'bcryptjs';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalUserReadRepository } from '@/lib/db/operational/sqlserver-operational-user-read-repository';
import { SqlServerOperationalUserWriteRepository } from '@/lib/db/operational/sqlserver-operational-user-write-repository';
import { SqlServerOperationalAuditWriteRepository } from '@/lib/db/operational/sqlserver-operational-audit-write-repository';
import type { OperationalUserRole } from '@/lib/db/operational/operational-user-types';

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Sin permisos.' }, { status: 403 });
    }

    const runtime = getSharedSqlServerRuntime();
    const repo = new SqlServerOperationalUserReadRepository(runtime);
    const users = await repo.listAllUsersWithScopes();

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        isActive: u.isActive,
        glpiUserId: u.glpiUserId,
        sectors: u.sectorScopes.map((s) => s.sectorName),
        sectorScopes: u.sectorScopes.map((s) => ({
          id: s.id,
          sectorName: s.sectorName,
          glpiGroupId: s.glpiGroupId,
        })),
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Admin users list error:', error);
    return NextResponse.json(
      { error: 'Error al obtener usuarios.' },
      { status: 500 }
    );
  }
}

interface ScopeInput {
  sectorName: string;
  glpiGroupId?: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Sin permisos.' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo de petición inválido.' }, { status: 400 });
    }

    const { username, password, displayName, role, glpiUserId, scopes, sectors } = body as {
      username?: unknown;
      password?: unknown;
      displayName?: unknown;
      role?: unknown;
      glpiUserId?: unknown;
      scopes?: unknown;
      sectors?: unknown;
    };

    if (typeof username !== 'string' || username.trim() === '') {
      return NextResponse.json({ error: 'Falta username o es inválido.' }, { status: 400 });
    }
    const cleanUsername = username.trim();

    if (typeof password !== 'string' || password.trim() === '') {
      return NextResponse.json({ error: 'Falta password o es inválido.' }, { status: 400 });
    }
    const cleanPassword = password.trim();

    if (typeof displayName !== 'string' || displayName.trim() === '') {
      return NextResponse.json({ error: 'Falta displayName o es inválido.' }, { status: 400 });
    }
    const cleanDisplayName = displayName.trim();

    if (typeof role !== 'string') {
      return NextResponse.json({ error: 'Falta role o es inválido.' }, { status: 400 });
    }
    const validRoles = ['admin', 'coordinador_sistemas', 'priorizador', 'referente'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: `Rol invalido. Validos: ${validRoles.join(', ')}` }, { status: 400 });
    }
    const cleanRole = role;

    const runtime = getSharedSqlServerRuntime();
    const readRepo = new SqlServerOperationalUserReadRepository(runtime);

    if (glpiUserId !== undefined && glpiUserId !== null) {
      if (typeof glpiUserId !== 'number' || !Number.isSafeInteger(glpiUserId) || glpiUserId < 1) {
        return NextResponse.json({ error: 'glpiUserId invalido.' }, { status: 400 });
      }
      const glpiUserExists = await readRepo.checkGlpiUserExists(glpiUserId);
      if (!glpiUserExists) {
        return NextResponse.json({ error: `El glpiUserId ${glpiUserId} no existe en GLPI.` }, { status: 400 });
      }
    }
    const cleanGlpiUserId = typeof glpiUserId === 'number' ? glpiUserId : null;

    let finalScopes: ScopeInput[] = [];
    if (scopes !== undefined) {
      if (!Array.isArray(scopes)) {
        return NextResponse.json({ error: 'scopes debe ser un arreglo.' }, { status: 400 });
      }
      if (['priorizador', 'referente'].includes(cleanRole) && scopes.length === 0) {
        return NextResponse.json({ error: 'Los roles estructurados requieren al menos un scope.' }, { status: 400 });
      }

      const seenGroups = new Set<number>();
      const seenNames = new Set<string>();

      for (const s of scopes) {
        if (!s || typeof s !== 'object') return NextResponse.json({ error: 'Scope inválido.' }, { status: 400 });
        const sObj = s as ScopeInput;

        if (!sObj.sectorName || typeof sObj.sectorName !== 'string' || sObj.sectorName.trim() === '') {
          return NextResponse.json({ error: 'Cada scope requiere un sectorName no vacío.' }, { status: 400 });
        }
        const sName = sObj.sectorName.trim();
        if (seenNames.has(sName)) {
          return NextResponse.json({ error: `sectorName duplicado en scopes: ${sName}` }, { status: 400 });
        }
        seenNames.add(sName);

        if (['priorizador', 'referente'].includes(cleanRole) && (sObj.glpiGroupId === undefined || sObj.glpiGroupId === null)) {
          return NextResponse.json({ error: `El scope ${sName} de un priorizador/referente requiere glpiGroupId.` }, { status: 400 });
        }

        if (sObj.glpiGroupId !== undefined && sObj.glpiGroupId !== null) {
          if (typeof sObj.glpiGroupId !== 'number' || !Number.isSafeInteger(sObj.glpiGroupId) || sObj.glpiGroupId < 1) {
            return NextResponse.json({ error: `glpiGroupId invalido en scope ${sName}.` }, { status: 400 });
          }
          if (seenGroups.has(sObj.glpiGroupId)) {
            return NextResponse.json({ error: `El glpiGroupId ${sObj.glpiGroupId} está duplicado en los scopes provistos.` }, { status: 400 });
          }
          seenGroups.add(sObj.glpiGroupId);
          const groupExists = await readRepo.checkGlpiGroupExists(sObj.glpiGroupId);
          if (!groupExists) {
            return NextResponse.json({ error: `El glpiGroupId ${sObj.glpiGroupId} no existe en GLPI.` }, { status: 400 });
          }
        }
        finalScopes.push({ sectorName: sName, glpiGroupId: sObj.glpiGroupId ?? null });
      }
    } else if (sectors !== undefined) {
      if (!Array.isArray(sectors)) {
        return NextResponse.json({ error: 'sectors debe ser un arreglo.' }, { status: 400 });
      }
      if (['priorizador', 'referente'].includes(cleanRole)) {
        return NextResponse.json({ error: 'Los roles Priorizador/Referente requieren scopes estructurados, no se permite array legacy.' }, { status: 400 });
      }
      finalScopes = sectors.map((s: unknown) => ({ sectorName: typeof s === 'string' ? s.trim() : String(s), glpiGroupId: null }));
    } else if (['priorizador', 'referente'].includes(cleanRole)) {
      return NextResponse.json({ error: 'Los roles estructurados requieren scopes.' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 12);

    const result = await runtime.withTransaction({ isolation: 'serializable' }, async (tx) => {
      const txRead = new SqlServerOperationalUserReadRepository(tx);
      const txWrite = new SqlServerOperationalUserWriteRepository(tx);
      const auditWrite = new SqlServerOperationalAuditWriteRepository(tx);

      if (cleanGlpiUserId !== null) {
        const existingGlpi = await txRead.findByGlpiUserId(cleanGlpiUserId);
        if (existingGlpi) {
          throw new Error(`CONFLICT:glpiUserId ${cleanGlpiUserId} ya esta asignado a ${existingGlpi.username}.`);
        }
      }

      if (['priorizador', 'referente'].includes(cleanRole)) {
        if (cleanGlpiUserId === null) {
          throw new Error('BADREQUEST:Un priorizador/referente activo no puede tener glpiUserId nulo.');
        }
        const groupIds = finalScopes.map(s => s.glpiGroupId).filter((id): id is number => id !== null);
        if (groupIds.length === 0) {
          throw new Error('BADREQUEST:Un priorizador/referente activo debe tener al menos un scope con glpiGroupId.');
        }

        // Allow multiple priorizadores per sector.
      }

      const now = new Date();
      const newUserId = await txWrite.createUser({
        username: cleanUsername,
        passwordHash,
        displayName: cleanDisplayName,
        role: cleanRole as OperationalUserRole,
        isActive: true,
        glpiUserId: cleanGlpiUserId,
        adObjectId: null,
        email: null,
        authSource: 'local',
        directoryActive: null,
        directoryStatusCheckedAt: null,
        createdAt: now,
        updatedAt: now
      });

      await txWrite.replaceScopes(newUserId, finalScopes.map(s => ({
        sectorName: s.sectorName,
        glpiGroupId: s.glpiGroupId ?? null
      })));

      if (cleanRole === 'priorizador') {
        const groupIds = finalScopes.map(s => s.glpiGroupId).filter((id): id is number => id !== null);
        await txWrite.replaceReferentAssignments(newUserId, groupIds);
      }

      const newUser = await txRead.findByIdWithScopes(newUserId);
      if (!newUser) throw new Error('Error interno: usuario creado no encontrado.');

      await auditWrite.writeAudit({
        userId: user.userId,
        action: 'user_create',
        entityType: 'user',
        entityId: String(newUserId),
        actorName: user.displayName,
        actorUsername: user.username,
        afterData: {
          username: newUser.username,
          displayName: newUser.displayName,
          role: newUser.role,
          glpiUserId: newUser.glpiUserId,
          scopes: newUser.sectorScopes,
        }
      });

      if (cleanRole === 'priorizador') {
        await auditWrite.writeAudit({
          userId: user.userId,
          action: 'user_referent_change',
          entityType: 'user',
          entityId: String(newUserId),
          actorName: user.displayName,
          actorUsername: user.username,
          beforeData: { role: null, isActive: null, scopes: [] },
          afterData: { role: newUser.role, isActive: newUser.isActive, scopes: newUser.sectorScopes }
        });
      }

      return newUser;
    });

    return NextResponse.json({
      user: {
        id: result.id,
        username: result.username,
        displayName: result.displayName,
        role: result.role,
        glpiUserId: result.glpiUserId,
        sectors: result.sectorScopes.map((s) => s.sectorName),
        sectorScopes: result.sectorScopes.map((s) => ({
          sectorName: s.sectorName,
          glpiGroupId: s.glpiGroupId,
        })),
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith('BADREQUEST:')) {
        return NextResponse.json({ error: error.message.replace('BADREQUEST:', '') }, { status: 400 });
      }
      if (error.message.startsWith('CONFLICT:')) {
        return NextResponse.json({ error: error.message.replace('CONFLICT:', '') }, { status: 409 });
      }
    }
    if (typeof error === 'object' && error !== null && 'code' in error && (error as {code: string}).code === 'P2002') {
      return NextResponse.json({ error: 'Violación de unicidad. El usuario o dato ya existe.' }, { status: 409 });
    }
    console.error('Admin create user error:', error);
    return NextResponse.json({ error: 'Error al crear usuario.' }, { status: 500 });
  }
}
