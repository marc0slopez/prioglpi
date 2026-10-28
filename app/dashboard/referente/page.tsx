'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDate } from '@/lib/formatDate';
import TicketGlpiSummary, { type TicketGlpiSummaryData } from '@/app/components/TicketGlpiSummary';
import { normalizeTicketView, TicketView } from '@/lib/ticket-view';

interface TicketFull {
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
  glpiSummary?: TicketGlpiSummaryData;
  rankings?: { rankPosition: number; sectorName: string; glpiGroupId: number }[];
  coordination: {
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

export default function ReferentePage() {
  const searchParams = useSearchParams();
  const [viewFilter, setViewFilter] = useState<TicketView>(normalizeTicketView(searchParams.get('view')));
  const [tickets, setTickets] = useState<TicketFull[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTickets, setTotalTickets] = useState(0);

  const [loading, setLoading] = useState(true);
  const [sectorName, setSectorName] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.sectors?.length > 0) setSectorName(data.sectors[0]);
      });
  }, []);

  const fetchData = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('view', viewFilter);
      if (statusFilter) {
        params.set('status', statusFilter);
      }
      params.set('page', currentPage.toString());
      const query = params.toString() ? `?${params.toString()}` : '';

      const ticketsRes = await fetch(`/api/tickets${query}`, { signal });

      if (ticketsRes.ok) {
        const data = await ticketsRes.json();
        const sorted = (data.tickets || []).sort((a: TicketFull, b: TicketFull) => {
          const aRank = a.rankings?.[0]?.rankPosition ?? 9999;
          const bRank = b.rankings?.[0]?.rankPosition ?? 9999;
          return aRank - bRank;
        });
        setTickets(sorted);
        setTotalTickets(data.total || 0);
        setTotalPages(data.pages || 1);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('Error fetching data:', err);
      }
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, currentPage, viewFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && tickets.length === 0) {
    return (
      <div className="loading-state">
        <div className="spinner spinner-lg"></div>
        <p>Cargando tickets...</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">📋 Vista Referente</h1>
            <p className="page-subtitle">
              Tickets de {sectorName || 'tu sector'} — Ranking aplicado por Priorizador
            </p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Filters and Chips */}
        <div className="filters-bar" style={{ flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          <div className="view-selector" style={{ display: 'flex', gap: '0.5rem' }}>
            <button className={`btn btn-sm ${viewFilter === 'open' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setViewFilter('open'); setStatusFilter(''); setCurrentPage(1); }}>Activos</button>
            <button className={`btn btn-sm ${viewFilter === 'history' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setViewFilter('history'); setStatusFilter(''); setCurrentPage(1); }}>Cerrados/Resueltos</button>
            <button className={`btn btn-sm ${viewFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setViewFilter('all'); setStatusFilter(''); setCurrentPage(1); }}>Todos</button>
          </div>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: '200px' }}>
            <span className="search-icon">🔍</span>
            <input
              type="text"
              className="form-input"
              placeholder="Buscar por número, título o texto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setCurrentPage(1);
                  fetchData();
                }
              }}
            />
          </div>
          <select
            className="form-input"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="">Todos los estados</option>
            {(viewFilter === 'open' || viewFilter === 'all') && (
              <>
                <option value="1">Nuevo</option>
                <option value="2">En curso</option>
                <option value="3">Planificado</option>
                <option value="4">En espera</option>
              </>
            )}
            {(viewFilter === 'history' || viewFilter === 'all') && (
              <>
                <option value="5">Resuelto</option>
                <option value="6">Cerrado</option>
              </>
            )}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={() => { setCurrentPage(1); fetchData(); }}>
            Buscar
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Mostrando {tickets.length} tickets de {totalTickets}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              Anterior
            </button>
            <span style={{ fontSize: '0.9rem' }}>Página {currentPage} de {totalPages}</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Siguiente
            </button>
          </div>
        </div>

        {/* Tickets - READ ONLY */}
        {tickets.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">Sin tickets</div>
            <div className="empty-state-text">No se encontraron tickets para tu sector.</div>
          </div>
        ) : (
          <div className="ticket-list">
            {tickets.map((t) => (
              <div key={t.ticketId} className="ticket-item" style={{ cursor: 'default' }}>
                <div
                  className="rank-badge"
                  style={!t.rankings?.[0] ? { background: 'var(--bg-glass)', color: 'var(--text-muted)' } : {}}
                >
                  {t.rankings?.[0]?.rankPosition || '—'}
                </div>
                <div className="ticket-info" style={{ flex: 1 }}>
                  <div className="ticket-info-header">
                    <a
                      className="ticket-id"
                      href={t.webUrl}
                      data-audit-ticket-id={t.ticketId}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      #{t.ticketId}
                    </a>
                    <span className={`badge ${STATUS_BADGE_MAP[t.statusLabel] || 'badge-nuevo'}`}>
                      {t.statusLabel}
                    </span>
                  </div>
                  <div className="ticket-title">{t.title}</div>
                  <div className="ticket-meta">
                    <span>👤 {t.requesterName || '—'}</span>
                    {t.typeLabel && <span>Tipo: {t.typeLabel}</span>}
                    <span>🔧 {t.assignedTechnician || '—'}</span>
                    <span>📅 {t.openedAt ? formatDate(t.openedAt) : '—'}</span>
                  </div>
                  <TicketGlpiSummary summary={t.glpiSummary} ticketId={t.ticketId} status={t.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
