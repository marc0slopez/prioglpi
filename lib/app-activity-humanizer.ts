const PAGE_NAMES: Record<string, string> = {
  '/dashboard/admin': 'Panel de administracion',
  '/dashboard/admin/modo-dios': 'Modo Dios',
  '/dashboard/coordinador': 'Bandeja de Sistemas',
  '/dashboard/coordinador/metricas': 'Metricas de Sistemas',
  '/dashboard/priorizador': 'Bandeja de priorizacion',
  '/dashboard/priorizador/metricas': 'Metricas de priorizacion',
  '/dashboard/referente': 'Tickets de referente',
  '/dashboard/referente/metricas': 'Metricas de referente',
};

export function describeAppActivity(action: string, entityId: string, afterData: unknown) {
  const data = afterData && typeof afterData === 'object' && !Array.isArray(afterData)
    ? afterData as Record<string, unknown> : {};
  if (action === 'app_page_view') {
    const page = PAGE_NAMES[entityId] || entityId;
    return { targetId: page, summary: `Ingreso a ${page}`, afterSummary: entityId };
  }
  if (action === 'glpi_ticket_open') {
    return { targetId: `#${entityId}`, summary: `Abrio el ticket #${entityId} en GLPI`, afterSummary: 'Enlace desde PrioGLPI' };
  }
  if (action === 'ticket_detail_view') {
    return { targetId: `#${entityId}`, summary: `Consulto el detalle del ticket #${entityId}`, afterSummary: 'Detalle en PrioGLPI' };
  }
  if (action === 'ticket_list_view') {
    const filters = data.filters && typeof data.filters === 'object' && !Array.isArray(data.filters)
      ? data.filters as Record<string, unknown> : {};
    const view = String(filters.view || 'open');
    const count = typeof data.resultCount === 'number' ? data.resultCount : 0;
    return {
      targetId: entityId === 'list' ? 'Bandeja' : `#${entityId}`,
      summary: `Consulto la bandeja (${view}, ${count} tickets en la pagina)`,
      afterSummary: `Pagina ${String(filters.page || 1)} de la consulta`,
    };
  }
  return null;
}
