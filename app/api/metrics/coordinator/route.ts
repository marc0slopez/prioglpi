import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getPeriodRange, validateYearAnchor } from '@/lib/date-utils';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalMetricsRepository } from '@/lib/db/operational/sqlserver-operational-metrics-repository';
import { getOverdueTtrCount } from '@/lib/glpi-ttr-metrics';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    if (!['coordinador_sistemas', 'tecnico_sistemas', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Sin permisos.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period');
    if (periodParam !== null && !['day', 'week', 'month', 'year', 'custom'].includes(periodParam)) {
      return NextResponse.json({ error: 'Período inválido.' }, { status: 400 });
    }
    const period = periodParam ?? 'month';

    const anchorDate = searchParams.get('anchorDate');
    if (!validateYearAnchor(period, anchorDate)) {
      return NextResponse.json({ error: 'No se permite consultar años históricos con period=year.' }, { status: 400 });
    }
    const statusParam = searchParams.get('status');
    let status: number | undefined;
    if (statusParam !== null) {
      if (!/^[1-6]$/.test(statusParam)) return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 });
      status = Number(statusParam);
    }

    const viewParam = searchParams.get('view');
    let view = 'all';
    if (viewParam !== null) {
      if (!['open', 'history', 'all'].includes(viewParam)) return NextResponse.json({ error: 'view inválido.' }, { status: 400 });
      view = viewParam;
    }

    const unassignedParam = searchParams.get('unassignedTechnician');
    let unassignedTechnician = false;
    if (unassignedParam !== null) {
      if (!['true', 'false'].includes(unassignedParam)) return NextResponse.json({ error: 'unassignedTechnician estricto true/false.' }, { status: 400 });
      unassignedTechnician = unassignedParam === 'true';
    }

    const technicianIdParam = searchParams.get('technicianId');
    let technicianId: number | undefined;
    if (technicianIdParam && technicianIdParam !== 'todos') {
      if (!/^\d+$/.test(technicianIdParam)) return NextResponse.json({ error: 'Filtro technicianId inválido.' }, { status: 400 });
      const tid = Number(technicianIdParam);
      if (!Number.isSafeInteger(tid) || tid < 1) return NextResponse.json({ error: 'technicianId inválido.' }, { status: 400 });
      technicianId = tid;
    }

    if (unassignedTechnician && technicianId !== undefined) {
      return NextResponse.json({ error: 'technicianId y unassignedTechnician son mutuamente exclusivos.' }, { status: 400 });
    }

    const requesterIdParam = searchParams.get('requesterId');
    let requesterId: number | undefined;
    if (requesterIdParam !== null) {
      requesterId = parseInt(requesterIdParam, 10);
      if (isNaN(requesterId) || requesterId < 1) return NextResponse.json({ error: 'requesterId inválido.' }, { status: 400 });
    }

    const sectorGroupIdParam = searchParams.get('sectorGroupId');
    let sectorGroupId: number | undefined;
    if (sectorGroupIdParam !== null) {
      sectorGroupId = parseInt(sectorGroupIdParam, 10);
      if (isNaN(sectorGroupId) || sectorGroupId < 1) return NextResponse.json({ error: 'sectorGroupId inválido.' }, { status: 400 });
    }

    let range: { start: string; end: string };
    if (period === 'custom') {
      const startDate = searchParams.get('startDate');
      const endDate = searchParams.get('endDate');
      if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return NextResponse.json({ error: 'Fechas personalizadas inválidas.' }, { status: 400 });
      }

      const endObj = new Date(endDate);
      endObj.setUTCDate(endObj.getUTCDate() + 1);
      const endStr = endObj.toISOString().split('T')[0];

      range = {
        start: `${startDate} 00:00:00`,
        end: `${endStr} 00:00:00`
      };
    } else {
      range = getPeriodRange(period, anchorDate);
    }
    const runtime = getSharedSqlServerRuntime();
    const repo = new SqlServerOperationalMetricsRepository(runtime);

    const { backlogTicketIds, ...metrics } = await repo.getCoordinatorMetrics({
      period,
      range,
      status,
      view,
      unassignedTechnician,
      technicianId,
      requesterId,
      sectorGroupId
    });

    let overdueTtr: number | null = null;
    try {
      overdueTtr = await getOverdueTtrCount(backlogTicketIds);
    } catch (error) {
      console.warn('[COORDINATOR_TTR_METRICS_UNAVAILABLE]', error);
    }

    return NextResponse.json({
      ...metrics,
      overdueCount: overdueTtr,
      kpis: { ...metrics.kpis, etaVencida: overdueTtr, tprVencida: overdueTtr },
    });
  } catch (error: any) {
    if (error instanceof Error && error.message === 'FORBIDDEN_TECHNICIAN') {
      return NextResponse.json({ error: 'Técnico inválido o no autorizado.' }, { status: 403 });
    }
    console.error('[COORDINATOR_METRICS_ERROR]', error?.message || error);
    return NextResponse.json({ error: 'Error al obtener métricas.' }, { status: 500 });
  }
}
