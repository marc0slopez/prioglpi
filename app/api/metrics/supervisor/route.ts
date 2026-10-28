import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getPeriodRange, validateYearAnchor } from '@/lib/date-utils';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalMetricsRepository } from '@/lib/db/operational/sqlserver-operational-metrics-repository';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    if (!['referente', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Sin permisos.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period');
    if (periodParam !== null && !['day', 'week', 'month', 'year'].includes(periodParam)) {
      return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
    }
    const period = periodParam ?? 'month';

    const anchorDate = searchParams.get('anchorDate');
    if (!validateYearAnchor(period, anchorDate)) {
      return NextResponse.json({ error: 'No se permite consultar años históricos con period=year.' }, { status: 400 });
    }
    const requester = searchParams.get('requester');
    const statusParam = searchParams.get('status');
    let status: number | undefined;

    if (statusParam !== null) {
      if (!/^[1-6]$/.test(statusParam)) {
        return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 });
      }
      status = Number(statusParam);
    }

    if (requester && requester !== 'todos') {
      if (!/^\d+$/.test(requester)) {
        return NextResponse.json({ error: 'Filtro requester inválido.' }, { status: 400 });
      }
      const reqUserId = Number(requester);
      if (!Number.isSafeInteger(reqUserId) || reqUserId < 1) {
        return NextResponse.json({ error: 'Filtro requester inválido.' }, { status: 400 });
      }
    }

    const range = getPeriodRange(period, anchorDate);
    const runtime = getSharedSqlServerRuntime();
    const repo = new SqlServerOperationalMetricsRepository(runtime);

    const metrics = await repo.getSupervisorMetrics({
      range,
      status,
      requester: requester ?? undefined,
      userRole: user.role,
      userSectorGroupIds: user.sectorGroupIds
    });

    return NextResponse.json(metrics);
  } catch (error) {
    if (error instanceof Error && error.message === 'FORBIDDEN_REQUESTER') {
      return NextResponse.json({ error: 'Solicitante no pertenece a su equipo.' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Error al obtener métricas.' }, { status: 500 });
  }
}
