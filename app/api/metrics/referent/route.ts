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

    if (!['priorizador', 'referente', 'admin'].includes(user.role)) {
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
    const sectorGroupIdParam = searchParams.get('sectorGroupId');
    const statusParam = searchParams.get('status');
    let status: number | undefined;

    if (statusParam !== null) {
      if (!/^[1-6]$/.test(statusParam)) {
        return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 });
      }
      status = Number(statusParam);
    }

    let sectorGroupId: number | undefined;
    if (sectorGroupIdParam !== null) {
      if (!/^\d+$/.test(sectorGroupIdParam)) {
        return NextResponse.json({ error: 'sectorGroupId inválido. Debe ser numérico.' }, { status: 400 });
      }
      sectorGroupId = parseInt(sectorGroupIdParam, 10);
      if (!Number.isSafeInteger(sectorGroupId) || sectorGroupId < 1) {
        return NextResponse.json({ error: 'sectorGroupId inválido.' }, { status: 400 });
      }
      if ((user.role === 'priorizador' || user.role === 'referente') && !user.sectorGroupIds.includes(sectorGroupId)) {
        return NextResponse.json({ error: 'Sin acceso a este sector.' }, { status: 403 });
      }
    }

    const requesterIdParam = searchParams.get('requesterId');
    let requesterId: number | undefined;
    if (requesterIdParam !== null) {
      requesterId = parseInt(requesterIdParam, 10);
      if (isNaN(requesterId) || requesterId < 1) return NextResponse.json({ error: 'requesterId inválido.' }, { status: 400 });
    }

    const technicianIdParam = searchParams.get('technicianId');
    let technicianId: number | undefined;
    if (technicianIdParam !== null) {
      technicianId = parseInt(technicianIdParam, 10);
      if (isNaN(technicianId) || technicianId < 1) return NextResponse.json({ error: 'technicianId inválido.' }, { status: 400 });
    }

    const unassignedTechnician = searchParams.get('unassignedTechnician') === 'true';

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

    const metrics = await repo.getReferentMetrics({
      range,
      status,
      sectorGroupId,
      userRole: user.role,
      userSectorGroupIds: user.sectorGroupIds,
      ownerUserId: user.userId,
      requesterId,
      technicianId,
      unassignedTechnician
    });

    return NextResponse.json(metrics);
  } catch (error: any) {
    console.error('[REFERENT_METRICS_ERROR]', error?.message || error);
    return NextResponse.json({ error: 'Error al obtener métricas.' }, { status: 500 });
  }
}
