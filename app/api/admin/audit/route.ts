import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalAuditReadRepository } from '@/lib/db/operational/sqlserver-operational-audit-read-repository';
import type { HumanizedAudit } from '@/lib/audit-humanizer';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Sin permisos.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const pageStr = searchParams.get('page');
    let page = 1;
    if (pageStr !== null) {
      if (!/^\d+$/.test(pageStr)) {
        return NextResponse.json({ error: 'page debe ser un entero positivo.' }, { status: 400 });
      }
      const pId = parseInt(pageStr, 10);
      if (!Number.isSafeInteger(pId) || pId < 1) {
        return NextResponse.json({ error: 'page inválido.' }, { status: 400 });
      }
      page = pId;
    }
    const limit = 50;

    const queryParams = {
      user: searchParams.get('user'),
      entityType: searchParams.get('entityType'),
      action: searchParams.get('action'),
      ticketId: searchParams.get('ticketId'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    };

    const runtime = getSharedSqlServerRuntime();
    const repo = new SqlServerOperationalAuditReadRepository(runtime);

    let logs: HumanizedAudit[];
    let total: number;

    try {
      [logs, total] = await Promise.all([
        repo.searchAuditsHumanized(queryParams, page, limit),
        repo.countAudits(queryParams)
      ]);
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'Filtros inválidos.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      logs,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Audit log error:', error);
    return NextResponse.json(
      { error: 'Error al obtener auditoría.' },
      { status: 500 }
    );
  }
}
