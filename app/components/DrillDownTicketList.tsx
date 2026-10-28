'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { formatDate } from '@/lib/formatDate';
import CoordinatorComment from '@/app/components/CoordinatorComment';

interface TicketData {
  ticketId: number;
  title: string;
  status: number;
  statusLabel: string;
  type?: number | null;
  typeLabel?: string | null;
  openedAt: string;
  requesterName: string;
  assignedTechnician: string;
  detectedSector: string;
  detectedSectorGroupId?: number | null;
  webUrl: string;
  coordination?: {
    progressPercent: number;
    coordinatorComment: string;
    estimatedDeliveryDate: string | null;
  } | null;
}

const STATUS_BADGE_MAP: Record<string, string> = {
  'Nuevo': 'badge-nuevo',
  'En curso': 'badge-encurso',
  'Planificado': 'badge-planificado',
  'En espera': 'badge-enespera',
  'Resuelto': 'badge-resuelto',
  'Cerrado': 'badge-cerrado',
};

export interface DrillDownFilters {
  type: 'status' | 'sector' | 'technician' | 'requester';
  id: number | null;
  name: string;
}

interface DrillDownTicketListProps {
  drillDown: DrillDownFilters | null;
  period: string;
  startDate?: string;
  endDate?: string;
  sectorGroupId: number | 'todos';
  requesterId?: number;
  technicianId?: number | 'unassigned';
  onClear: () => void;
}

export default function DrillDownTicketList({
  drillDown,
  period,
  startDate,
  endDate,
  sectorGroupId,
  requesterId,
  technicianId,
  onClear,
}: DrillDownTicketListProps) {
  const [tickets, setTickets] = useState<TicketData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('No se pudieron cargar los tickets.');

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 10;

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchTickets = useCallback(async (currentPage: number) => {
    if (!drillDown) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(false);

    try {
      const params = new URLSearchParams();
      params.set('page', currentPage.toString());
      params.set('limit', limit.toString());
      params.set('view', 'all');

      if (sectorGroupId !== 'todos') {
        params.set('sectorGroupId', sectorGroupId.toString());
      }
      if (requesterId !== undefined) {
        params.set('requesterId', requesterId.toString());
      }
      if (technicianId !== undefined) {
        if (technicianId === 'unassigned') params.set('unassignedTechnician', 'true');
        else params.set('technicianId', technicianId.toString());
      }

      if (period === 'custom' && startDate && endDate) {
        params.set('from', startDate);
        params.set('to', endDate);
      } else {
        const now = new Date();
        let fromDate = new Date();
        if (period === 'day') {
          // today
        } else if (period === 'week') {
          fromDate.setDate(now.getDate() - now.getDay());
        } else if (period === 'month') {
          fromDate.setDate(1);
        } else if (period === 'year') {
          fromDate.setMonth(0, 1);
        }

        if (period !== 'all') {
          params.set('from', fromDate.toISOString().split('T')[0]);
        }
      }

      if (drillDown.type === 'status' && drillDown.id !== null) {
        params.set('status', drillDown.id.toString());
      } else if (drillDown.type === 'sector' && drillDown.id !== null) {
        params.set('sectorGroupId', drillDown.id.toString()); // If it's sector id
      } else if (drillDown.type === 'sector' && drillDown.id === null) {
         params.set('sector', drillDown.name); // If we only have name
      } else if (drillDown.type === 'technician') {
        if (drillDown.id === null || drillDown.name === 'Sin asignar') {
          params.set('unassignedTechnician', 'true');
        } else if (drillDown.name === 'Soporte Dycos') {
          params.set('soporteDycos', 'true');
        } else {
          params.set('technicianId', drillDown.id.toString());
        }
      } else if (drillDown.type === 'requester') {
        if (drillDown.id !== null && drillDown.name !== 'Sin solicitante') {
          params.set('requesterId', drillDown.id.toString());
        }
      }

      const res = await fetch(`/api/tickets?${params.toString()}`, {
        signal: controller.signal
      });

      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
        setTotalPages(data.pages || 1);
        setTotalCount(data.total || 0);
      } else {
        const errData = await res.json().catch(() => ({}));
        setErrorMessage(errData.error || `HTTP ${res.status}`);
        setError(true);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setErrorMessage(e instanceof Error ? e.message : 'Error desconocido');
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [drillDown, period, startDate, endDate, sectorGroupId, requesterId, technicianId]);

  useEffect(() => {
    setPage(1);
    fetchTickets(1);
  }, [drillDown, period, startDate, endDate, sectorGroupId, fetchTickets]);

  useEffect(() => {
    if (page > 1) {
       fetchTickets(page);
    }
  }, [page, fetchTickets]);

  if (!drillDown) return null;

  let filterLabel = '';
  switch (drillDown.type) {
    case 'status': filterLabel = `Estado: ${drillDown.name}`; break;
    case 'sector': filterLabel = `Sector: ${drillDown.name}`; break;
    case 'technician': filterLabel = `Técnico: ${drillDown.name}`; break;
    case 'requester': filterLabel = `Solicitante: ${drillDown.name}`; break;
  }

  return (
    <div style={{ marginTop: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <div style={{ background: '#f97316', color: '#fff', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
          Drill-down activo: {filterLabel}
        </div>
        <button
          onClick={onClear}
          className="btn btn-secondary btn-sm"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
        >
          Limpiar todo
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            Mostrando {tickets.length} tickets de {totalCount}
          </span>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Anterior
              </button>
              <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 'bold' }}>Página {page} de {totalPages}</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Siguiente
              </button>
            </div>
          )}
      </div>

      <div className="card-body" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-state" style={{ padding: '40px' }}>
            <div className="spinner spinner-lg"></div>
            <p>Cargando tickets...</p>
          </div>
        ) : error ? (
          <div className="empty-state" style={{ padding: '40px' }}>
            <div className="empty-state-icon">❌</div>
            <div className="empty-state-title">Error</div>
            <div className="empty-state-text">{errorMessage}</div>
          </div>
        ) : tickets.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px' }}>
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">Sin tickets</div>
            <div className="empty-state-text">No se encontraron tickets con este filtro.</div>
          </div>
        ) : (
          <div className="ticket-list">
            {tickets.map((t) => (
              <div key={t.ticketId} className="ticket-item" style={{ cursor: 'default', background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '8px' }}>
                <div className="ticket-info" style={{ flex: 1 }}>
                  <div className="ticket-info-header" style={{ marginBottom: '8px' }}>
                    <a
                      className="ticket-id"
                      href={t.webUrl}
                      data-audit-ticket-id={t.ticketId}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontWeight: 'bold', color: 'var(--accent-primary)', marginRight: '12px' }}
                    >
                      #{t.ticketId}
                    </a>
                    <span className={`badge ${STATUS_BADGE_MAP[t.statusLabel] || 'badge-nuevo'}`} style={{ marginRight: '8px' }}>
                      {t.statusLabel}
                    </span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', float: 'right' }}>
                      Sin datos de coordinacion
                    </span>
                  </div>
                  <div className="ticket-title" style={{ fontSize: '15px', marginBottom: '8px' }}>{t.title}</div>
                  <div className="ticket-meta" style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <span>👤 {t.requesterName || '—'}</span>
                    <span>🏢 {t.detectedSector}</span>
                    {t.typeLabel && <span>Tipo: {t.typeLabel}</span>}
                    <span>🔧 {t.assignedTechnician || '—'}</span>
                    <span>📅 {t.openedAt ? formatDate(t.openedAt) : '—'}</span>
                  </div>
                  {t.coordination?.coordinatorComment && (
                    <CoordinatorComment text={t.coordination.coordinatorComment} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
