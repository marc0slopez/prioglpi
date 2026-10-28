import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalTicketFilterOptionsRepository } from '@/lib/db/operational/sqlserver-operational-ticket-filter-options-repository';
import {
  buildOperationalTicketFilterOptions,
  type OperationalTicketFilterOptionsRole
} from '@/lib/db/operational/operational-ticket-filter-options-service';

function isOperationalTicketFilterOptionsRole(
  role: string
): role is OperationalTicketFilterOptionsRole {
  return (
    role === 'admin' ||
    role === 'coordinador_sistemas' ||
    role === 'tecnico_sistemas' ||
    role === 'priorizador' ||
    role === 'referente'
  );
}

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    if (!isOperationalTicketFilterOptionsRole(user.role)) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    const actor = {
      role: user.role,
      sectorScopes: user.sectorScopes
    };

    const runtime = getSharedSqlServerRuntime();
    const repository = new SqlServerOperationalTicketFilterOptionsRepository(runtime);
    const response = await buildOperationalTicketFilterOptions(repository, actor);

    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}
