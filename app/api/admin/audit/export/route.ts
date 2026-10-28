import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSharedSqlServerRuntime } from '@/lib/db/sqlserver-runtime-factory';
import { SqlServerOperationalAuditReadRepository } from '@/lib/db/operational/sqlserver-operational-audit-read-repository';
import exceljs from 'exceljs';
import { PassThrough, Readable } from 'stream';

export const runtime = 'nodejs';

function neutralizeFormula(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  if (/^[=+\-@\t\r\n]/.test(val)) {
    return `'${val}`;
  }
  return val;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Sin permisos.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
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

    let maxLog;
    try {
      maxLog = await repo.getMaxLog(queryParams);
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'Filtros inválidos.' },
        { status: 400 }
      );
    }

    const totalEvents = maxLog ? await repo.countAuditsSnapshot(queryParams, maxLog.createdAt, maxLog.id) : 0;
    if (totalEvents > 1048575) {
      return NextResponse.json(
        { error: 'El reporte excede el límite máximo físico de una hoja Excel (1,048,575 eventos). Por favor acote el rango de fechas o aplique filtros adicionales' },
        { status: 400 }
      );
    }

    const passThrough = new PassThrough();
    const workbook = new exceljs.stream.xlsx.WorkbookWriter({
      stream: passThrough,
      useStyles: true,
      useSharedStrings: false,
    });

    // Hoja 1: Auditoría
    const worksheet = workbook.addWorksheet('Auditoría', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Fecha y hora', key: 'createdAtDate', width: 20 },
      { header: 'Nombre', key: 'actorName', width: 25 },
      { header: 'Usuario', key: 'actorUsername', width: 20 },
      { header: 'Acción', key: 'actionLabel', width: 30 },
      { header: 'Entidad', key: 'entityLabel', width: 18 },
      { header: 'Ticket/ID', key: 'targetId', width: 18 },
      { header: 'Sector', key: 'sectorName', width: 25 },
      { header: 'Resumen', key: 'summary', width: 50 },
      { header: 'Valor anterior', key: 'beforeSummary', width: 40 },
      { header: 'Valor nuevo', key: 'afterSummary', width: 40 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getColumn('createdAtDate').numFmt = 'dd/mm/yyyy hh:mm';
    worksheet.getColumn('summary').alignment = { wrapText: true };
    worksheet.getColumn('beforeSummary').alignment = { wrapText: true };
    worksheet.getColumn('afterSummary').alignment = { wrapText: true };
    worksheet.autoFilter = 'A1:K1';

    // Hoja 2: Detalle
    const worksheet2 = workbook.addWorksheet('Detalle', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });
    worksheet2.columns = [
      { header: 'ID Evento', key: 'id', width: 10 },
      { header: 'Fecha ISO original', key: 'createdAtIso', width: 26 },
      { header: 'Acción canónica', key: 'actionCanonical', width: 25 },
      { header: 'Entidad canónica', key: 'entityTypeCanonical', width: 20 },
      { header: 'EntityID crudo', key: 'entityIdOriginal', width: 20 },
      { header: 'Comentario anterior COMPLETO', key: 'previousComment', width: 40 },
      { header: 'Comentario nuevo COMPLETO', key: 'newComment', width: 40 },
      { header: 'Metadata completa Anterior', key: 'beforeJsonStr', width: 50 },
      { header: 'Metadata completa Nueva', key: 'afterJsonStr', width: 50 },
    ];

    worksheet2.getRow(1).font = { bold: true };
    worksheet2.getColumn('previousComment').alignment = { wrapText: true };
    worksheet2.getColumn('newComment').alignment = { wrapText: true };
    worksheet2.getColumn('beforeJsonStr').alignment = { wrapText: true };
    worksheet2.getColumn('afterJsonStr').alignment = { wrapText: true };
    worksheet2.autoFilter = 'A1:I1';

    // Ejecución asíncrona de streaming por chunks en segundo plano
    void (async () => {
      try {
        const take = 1000;
        let totalProcessed = 0;
        let lastSeenCreatedAt: Date | null = null;
        let lastSeenId: number | null = null;

        if (maxLog) {
          while (totalProcessed < totalEvents) {
            const humanizedChunk = await repo.streamAuditsHumanized(
              queryParams,
              maxLog.createdAt,
              maxLog.id,
              take,
              lastSeenCreatedAt,
              lastSeenId
            );

            if (humanizedChunk.length === 0) break;

            for (const item of humanizedChunk) {
              const artDate = new Date(new Date(item.createdAtIso).getTime() - 3 * 3600 * 1000);
              worksheet.addRow({
                id: item.id,
                createdAtDate: artDate,
                actorName: neutralizeFormula(item.actorName),
                actorUsername: neutralizeFormula(item.actorUsername),
                actionLabel: neutralizeFormula(item.actionLabel),
                entityLabel: neutralizeFormula(item.entityLabel),
                targetId: neutralizeFormula(item.targetId),
                sectorName: neutralizeFormula(item.sectorName),
                summary: neutralizeFormula(item.summary),
                beforeSummary: neutralizeFormula(item.beforeSummary),
                afterSummary: neutralizeFormula(item.afterSummary),
              }).commit();

              const beforeJsonStr = item.beforeData ? JSON.stringify(item.beforeData) : '';
              const afterJsonStr = item.afterData ? JSON.stringify(item.afterData) : '';
              worksheet2.addRow({
                id: item.id,
                createdAtIso: neutralizeFormula(item.createdAtIso),
                actionCanonical: neutralizeFormula(item.actionCanonical),
                entityTypeCanonical: neutralizeFormula(item.entityTypeCanonical),
                entityIdOriginal: neutralizeFormula(item.entityIdOriginal),
                previousComment: neutralizeFormula(item.previousComment),
                newComment: neutralizeFormula(item.newComment),
                beforeJsonStr: neutralizeFormula(beforeJsonStr),
                afterJsonStr: neutralizeFormula(afterJsonStr),
              }).commit();
            }

            totalProcessed += humanizedChunk.length;
            const lastItem = humanizedChunk[humanizedChunk.length - 1];
            if (!lastItem) {
              break;
            }
            lastSeenCreatedAt = new Date(lastItem.createdAtIso);
            lastSeenId = lastItem.id;
            if (humanizedChunk.length < take) break;
          }
        }

        if (totalProcessed !== totalEvents) {
          throw new Error(`Inconsistencia en exportación: se procesaron ${totalProcessed} eventos de ${totalEvents} esperados en el snapshot.`);
        }

        worksheet.commit();
        worksheet2.commit();
        await workbook.commit();
      } catch (err) {
        console.error('Error writing Excel stream:', err);
        passThrough.destroy(err instanceof Error ? err : new Error('Stream failed'));
      }
    })();

    const webStream = Readable.toWeb(passThrough);
    const filename = `auditoria_prio_glpi_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(webStream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Audit export error:', error);
    return NextResponse.json(
      { error: 'Error al generar exportación Excel.' },
      { status: 500 }
    );
  }
}
