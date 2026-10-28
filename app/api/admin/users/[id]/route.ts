import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import * as bcrypt from 'bcryptjs';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalUserReadRepository } from '@/lib/db/operational/sqlserver-operational-user-read-repository';
import { SqlServerOperationalUserWriteRepository } from '@/lib/db/operational/sqlserver-operational-user-write-repository';
import { SqlServerOperationalAuditWriteRepository } from '@/lib/db/operational/sqlserver-operational-audit-write-repository';
import type { OperationalUserRole, OperationalUserUpdateInput } from '@/lib/db/operational/operational-user-types';

interface ScopeInput {
  sectorName: string;
  glpiGroupId?: number | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Sin permisos.' }, { status: 403 });
    }

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'ID invalido. Debe ser numérico.' }, { status: 400 });
    }
    const userId = parseInt(id, 10);
    if (!Number.isSafeInteger(userId) || userId < 1) {
      return NextResponse.json({ error: 'ID invalido.' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Cuerpo de petición inválido.' }, { status: 400 });
    }

    const { displayName, role, isActive, password, glpiUserId, scopes, sectors } = body as {
      displayName?: unknown;
      role?: unknown;
      isActive?: unknown;
      password?: unknown;
      glpiUserId?: unknown;
      scopes?: unknown;
      sectors?: unknown;
    };

    if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim() === '')) {
      return NextResponse.json({ error: 'displayName debe ser un texto no vacío.' }, { status: 400 });
    }
    const cleanDisplayName = typeof displayName === 'string' ? displayName.trim() : undefined;

    if (password !== undefined && (typeof password !== 'string' || password.trim() === '')) {
      return NextResponse.json({ error: 'password debe ser un texto no vacío.' }, { status: 400 });
    }
    const cleanPassword = typeof password === 'string' ? password.trim() : undefined;

    if (role !== undefined) {
      if (typeof role !== 'string') return NextResponse.json({ error: 'role debe ser un texto.' }, { status: 400 });
      const validRoles = ['admin', 'coordinador_sistemas', 'priorizador', 'referente'];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ error: `Rol invalido. Validos: ${validRoles.join(', ')}` }, { status: 400 });
      }
    }
    const cleanRole = typeof role === 'string' ? role : undefined;

    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive debe ser booleano.' }, { status: 400 });
    }
    const cleanIsActive = typeof isActive === 'boolean' ? isActive : undefined;

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
    const cleanGlpiUserId = typeof glpiUserId === 'number' ? glpiUserId : (glpiUserId === null ? null : undefined);

    const existingUserBeforeTx = await readRepo.findByIdWithScopes(userId);
    if (!existingUserBeforeTx) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
    const effectiveRolePreTx = cleanRole ?? existingUserBeforeTx.role;

    let finalScopes: ScopeInput[] | undefined;
    if (scopes !== undefined) {
      if (!Array.isArray(scopes)) {
        return NextResponse.json({ error: 'scopes debe ser un arreglo.' }, { status: 400 });
      }
      if (['priorizador', 'referente'].includes(effectiveRolePreTx) && scopes.length === 0) {
         return NextResponse.json({ error: `Los roles estructurados requieren al menos un scope.` }, { status: 400 });
      }

      finalScopes = [];
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

        if (['priorizador', 'referente'].includes(effectiveRolePreTx) && (sObj.glpiGroupId === undefined || sObj.glpiGroupId === null)) {
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
      if (['priorizador', 'referente'].includes(effectiveRolePreTx)) {
        return NextResponse.json({ error: 'Los roles Priorizador/Referente requieren scopes estructurados, no se permite array legacy.' }, { status: 400 });
      }
      finalScopes = sectors.map((s: unknown) => ({ sectorName: typeof s === 'string' ? s.trim() : String(s), glpiGroupId: null }));
    }

    const scopesChanged = finalScopes !== undefined;

    const result = await runtime.withTransaction({ isolation: 'serializable' }, async (tx) => {
      const txRead = new SqlServerOperationalUserReadRepository(tx);
      const txWrite = new SqlServerOperationalUserWriteRepository(tx);
      const auditWrite = new SqlServerOperationalAuditWriteRepository(tx);

      const existingUser = await txRead.findByIdWithScopes(userId);
      if (!existingUser) throw new Error('NOTFOUND:Usuario no encontrado.');

      if (cleanPassword && existingUser.authSource !== 'local') {
        throw new Error('BADREQUEST:No se puede cambiar la contraseña de un usuario que no es local.');
      }

      if (cleanGlpiUserId !== undefined && cleanGlpiUserId !== null && cleanGlpiUserId !== existingUser.glpiUserId) {
        const conflict = await txRead.findByGlpiUserId(cleanGlpiUserId);
        if (conflict && conflict.id !== userId) {
          throw new Error(`CONFLICT:glpiUserId ${cleanGlpiUserId} ya esta asignado a ${conflict.username}.`);
        }
      }

      const effectiveRole = cleanRole ?? existingUser.role;
      const effectiveActive = cleanIsActive ?? existingUser.isActive;
      const effectiveGlpiUserId = cleanGlpiUserId !== undefined ? cleanGlpiUserId : existingUser.glpiUserId;

      const willBeStructured = ['priorizador', 'referente'].includes(effectiveRole) && effectiveActive;
      const targetScopes = scopesChanged ? finalScopes! : existingUser.sectorScopes.map(s => ({ sectorName: s.sectorName, glpiGroupId: s.glpiGroupId }));

      if (willBeStructured) {
        if (effectiveGlpiUserId === null) {
          throw new Error('BADREQUEST:Un priorizador/referente activo no puede tener glpiUserId nulo.');
        }
        const newGroupIds = targetScopes.map(s => s.glpiGroupId).filter((id): id is number => id !== null);
        if (newGroupIds.length === 0) {
          throw new Error('BADREQUEST:Un priorizador/referente activo debe tener al menos un scope con glpiGroupId.');
        }
      }

      const updateData: OperationalUserUpdateInput = { updatedAt: new Date() };
      if (cleanDisplayName !== undefined) updateData.displayName = cleanDisplayName;
      if (cleanRole !== undefined) updateData.role = cleanRole as OperationalUserRole;
      if (cleanIsActive !== undefined) updateData.isActive = cleanIsActive;
      if (cleanGlpiUserId !== undefined) updateData.glpiUserId = cleanGlpiUserId;
      if (cleanPassword) updateData.passwordHash = await bcrypt.hash(cleanPassword, 12);

      if (Object.keys(updateData).length > 1) { // >1 because updatedAt is always there
        await txWrite.updateUser(userId, updateData);
      }

      if (scopesChanged) {
        await txWrite.replaceScopes(userId, targetScopes.map(s => ({ sectorName: s.sectorName, glpiGroupId: s.glpiGroupId ?? null })));
      }

      if (scopesChanged || cleanRole !== undefined || cleanIsActive !== undefined) {
        if (effectiveRole === 'priorizador' && effectiveActive) {
          const newGroupIds = targetScopes.map(s => s.glpiGroupId).filter((id): id is number => id !== null);
          await txWrite.replaceReferentAssignments(userId, newGroupIds);
        } else {
          await txWrite.replaceReferentAssignments(userId, []);
        }
      }

      const updatedUser = await txRead.findByIdWithScopes(userId);
      if (!updatedUser) throw new Error('NOTFOUND:Usuario no encontrado.');

      if (cleanRole !== undefined && cleanRole !== existingUser.role) {
        await auditWrite.writeAudit({
          userId: user.userId,
          action: 'user_role_change',
          entityType: 'user',
          entityId: String(userId),
          actorName: user.displayName,
          actorUsername: user.username,
          beforeData: { role: existingUser.role },
          afterData: { role: updatedUser.role }
        });
      }

      if (cleanDisplayName !== undefined || cleanGlpiUserId !== undefined || cleanPassword !== undefined) {
        await auditWrite.writeAudit({
          userId: user.userId,
          action: 'user_update',
          entityType: 'user',
          entityId: String(userId),
          actorName: user.displayName,
          actorUsername: user.username,
          beforeData: { displayName: existingUser.displayName, glpiUserId: existingUser.glpiUserId },
          afterData: { displayName: updatedUser.displayName, glpiUserId: updatedUser.glpiUserId, passwordChanged: !!cleanPassword }
        });
      }

      if (cleanIsActive !== undefined && cleanIsActive !== existingUser.isActive) {
        await auditWrite.writeAudit({
          userId: user.userId,
          action: cleanIsActive ? 'user_activate' : 'user_deactivate',
          entityType: 'user',
          entityId: String(userId),
          actorName: user.displayName,
          actorUsername: user.username,
          beforeData: { isActive: existingUser.isActive },
          afterData: { isActive: updatedUser.isActive }
        });
      }

      if (scopesChanged) {
        await auditWrite.writeAudit({
          userId: user.userId,
          action: 'user_scopes_change',
          entityType: 'user',
          entityId: String(userId),
          actorName: user.displayName,
          actorUsername: user.username,
          beforeData: { scopes: existingUser.sectorScopes },
          afterData: { scopes: updatedUser.sectorScopes }
        });
      }

      if ((existingUser.role === 'priorizador' || effectiveRole === 'priorizador') && (scopesChanged || cleanRole !== undefined || cleanIsActive !== undefined)) {
        await auditWrite.writeAudit({
          userId: user.userId,
          action: 'user_referent_change',
          entityType: 'user',
          entityId: String(userId),
          actorName: user.displayName,
          actorUsername: user.username,
          beforeData: { role: existingUser.role, isActive: existingUser.isActive, scopes: existingUser.sectorScopes },
          afterData: { role: updatedUser.role, isActive: updatedUser.isActive, scopes: updatedUser.sectorScopes }
        });
      }

      return updatedUser;
    });

    if (!result) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });

    return NextResponse.json({
      user: {
        id: result.id,
        username: result.username,
        displayName: result.displayName,
        role: result.role,
        isActive: result.isActive,
        glpiUserId: result.glpiUserId,
        sectors: result.sectorScopes.map((s) => s.sectorName),
        sectorScopes: result.sectorScopes.map((s) => ({
          sectorName: s.sectorName,
          glpiGroupId: s.glpiGroupId,
        })),
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.startsWith('BADREQUEST:')) {
        return NextResponse.json({ error: error.message.replace('BADREQUEST:', '') }, { status: 400 });
      }
      if (error.message.startsWith('CONFLICT:')) {
        return NextResponse.json({ error: error.message.replace('CONFLICT:', '') }, { status: 409 });
      }
      if (error.message.startsWith('NOTFOUND:')) {
        return NextResponse.json({ error: error.message.replace('NOTFOUND:', '') }, { status: 404 });
      }
    }
    if (typeof error === 'object' && error !== null && 'code' in error && (error as {code: string}).code === 'P2002') {
      return NextResponse.json({ error: 'Violación de unicidad. El usuario o dato ya existe.' }, { status: 409 });
    }
    console.error('Admin update user error:', error);
    return NextResponse.json({ error: 'Error al actualizar usuario.' }, { status: 500 });
  }
}
