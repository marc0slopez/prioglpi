import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalUserReadRepository } from '@/lib/db/operational/sqlserver-operational-user-read-repository';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    const runtime = getSharedSqlServerRuntime();
    const repo = new SqlServerOperationalUserReadRepository(runtime);
    const priorizadores = await repo.listActiveByRoles(['priorizador']);

    const result = priorizadores.map((u) => ({
      id: u.id,
      name: u.displayName,
      username: u.username
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('[GET /api/admin/users/priorizadores] Error:', error);
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}
