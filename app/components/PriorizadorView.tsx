'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDate } from '@/lib/formatDate';
import CoordinatorComment from '@/app/components/CoordinatorComment';
import { normalizeTicketView, TicketView } from '@/lib/ticket-view';

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

interface RankingEntry {
  id: number;
  ticketId: number;
  sectorName: string;
  glpiGroupId: number;
  rankPosition: number;
  prioritySetBy: string;
  ticket: TicketData;
}

const STATUS_BADGE_MAP: Record<string, string> = {
  'Nuevo': 'badge-nuevo',
  'En curso': 'badge-encurso',
  'Planificado': 'badge-planificado',
  'En espera': 'badge-enespera',
  'Resuelto': 'badge-resuelto',
  'Cerrado': 'badge-cerrado',
};

function EditablePriorityBadge({
  currentPosition,
  ticketId,
  maxPosition,
  onSave
}: {
  currentPosition: number;
  ticketId: number;
  maxPosition: number;
  onSave: (ticketId: number, newPosition: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentPosition.toString());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commit = () => {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num > 0 && num <= maxPosition && num !== currentPosition) {
      onSave(ticketId, num);
    } else {
      setValue(currentPosition.toString());
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={1}
        max={maxPosition}
        value={value}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setValue(currentPosition.toString());
            setIsEditing(false);
          }
        }}
        style={{
          width: '36px',
          height: '28px',
          textAlign: 'center',
          borderRadius: '4px',
          border: '1px solid var(--accent-primary)',
          background: 'var(--bg-input)',
          color: '#fff',
          fontWeight: 'bold',
          fontSize: '0.9rem',
          marginRight: '12px'
        }}
      />
    );
  }

  return (
    <div
      className="rank-badge"
      onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
      title="Hacer click para editar prioridad"
      style={{ cursor: 'pointer' }}
    >
      {currentPosition}
    </div>
  );
}

export default function PriorizadorView({ ownerUserId }: { ownerUserId?: number }) {
  const searchParams = useSearchParams();
  const [viewFilter, setViewFilter] = useState<TicketView>(normalizeTicketView(searchParams.get('view')));
  const [historyTickets, setHistoryTickets] = useState<TicketData[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPages, setHistoryPages] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [unranked, setUnranked] = useState<TicketData[]>([]);
  const [unrankedTotal, setUnrankedTotal] = useState(0);
  const [unrankedPage, setUnrankedPage] = useState(1);
  const [unrankedLimit] = useState(10);
  const [unrankedPages, setUnrankedPages] = useState(1);

  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);

  const removingLocksRef = useRef<Set<number>>(new Set());
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const dragUnrankedTicket = useRef<TicketData | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const fetchRankings = useCallback(async () => {
    setLoading(true);
    setErrorState(null);
    try {
      const url = ownerUserId
        ? `/api/rankings?sectorGroupId=todos&ownerUserId=${ownerUserId}`
        : `/api/rankings?sectorGroupId=todos`;
      const rankRes = await fetch(url);
      if (!rankRes.ok) {
        const err = await rankRes.json().catch(() => ({}));
        setErrorState(err.error || 'No se pudo cargar la bandeja del priorizador seleccionado');
        return;
      }

      const data = await rankRes.json();
      setRankings(data.rankings || []);

      const paramsU = new URLSearchParams('sectorGroupId=todos');
      paramsU.set('page', unrankedPage.toString());
      paramsU.set('limit', unrankedLimit.toString());
      if (ownerUserId) paramsU.set('ownerUserId', ownerUserId.toString());
      const unrankedRes = await fetch(`/api/tickets/unranked?${paramsU.toString()}`);
      if (!unrankedRes.ok) {
        const err = await unrankedRes.json().catch(() => ({}));
        setErrorState(err.error || 'No se pudo cargar la bandeja del priorizador seleccionado');
        return;
      }

      const unrankedData = await unrankedRes.json();
      setUnranked(unrankedData.tickets || []);
      setUnrankedTotal(unrankedData.total || 0);
      setUnrankedPages(unrankedData.pages || 1);
      if (unrankedData.pages > 0 && unrankedPage > unrankedData.pages) {
        setUnrankedPage(unrankedData.pages);
      }
    } catch {
      setErrorState('Error de conexión al cargar la bandeja.');
      showToast('Error al cargar datos de ranking.', 'error');
    } finally {
      setLoading(false);
    }
  }, [unrankedPage, unrankedLimit, ownerUserId]);

  const fetchHistoryTickets = useCallback(async () => {
    if (viewFilter === 'open') return;
    setLoadingHistory(true);
    setErrorState(null);
    try {
      const params = new URLSearchParams();
      params.set('view', viewFilter);
      params.set('sector', 'todos');
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', historyPage.toString());
      params.set('limit', '10');
      if (ownerUserId) params.set('ownerUserId', ownerUserId.toString());
      const res = await fetch(`/api/tickets?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorState(err.error || 'No se pudo cargar la bandeja de tickets.');
        return;
      }
      const data = await res.json();
      setHistoryTickets(data.tickets || []);
      setHistoryTotal(data.total || 0);
      setHistoryPages(data.pages || 1);
    } catch (err) {
      setErrorState('Error de conexión al cargar la bandeja.');
      console.error('Error fetching history tickets:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [viewFilter, historyPage, search, statusFilter, ownerUserId]);

  useEffect(() => {
    if (viewFilter === 'open') {
      fetchRankings();
    } else {
      fetchHistoryTickets();
    }
  }, [fetchRankings, fetchHistoryTickets, viewFilter]);

  function showToast(message: string, type: string) {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
  }

  const mutationInFlightRef = useRef(false);

  async function handleRemoveFromRanking(ticketId: number) {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setSaving(true);

    const prevRankings = [...rankings];
    const newRankings = rankings.filter(r => r.ticketId !== ticketId).map((r, i) => ({
      ...r,
      rankPosition: i + 1
    }));

    setRankings(newRankings);

    try {
      const deleteUrl = `/api/rankings/${ticketId}${ownerUserId ? `?ownerUserId=${ownerUserId}` : ''}`;
      const res = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.changed !== false) {
          showToast('Nueva priorización guardada', 'success');
        }
      } else {
        const data = await res.json();
        showToast(data.error || 'Error.', 'error');
        setRankings(prevRankings);
      }
    } catch {
      showToast('Error de conexión.', 'error');
      setRankings(prevRankings);
    } finally {
      mutationInFlightRef.current = false;
      setSaving(false);
      fetchRankings();
    }
  }

  function handleDragStart(ticketId: number) {
    dragItem.current = ticketId;
    dragUnrankedTicket.current = null;
  }
  function handleDragStartUnranked(ticket: TicketData) {
    dragItem.current = null;
    dragOverItem.current = null;
    dragUnrankedTicket.current = ticket;
  }
  function handleDragOverRanked(e: React.DragEvent) {
    e.preventDefault();
  }
  async function handleDropOnRanked(e: React.DragEvent) {
    e.preventDefault();
    const ticket = dragUnrankedTicket.current;
    dragUnrankedTicket.current = null;
    if (ticket) {
      await handleAddToRanking(ticket);
    }
  }
  function handleDragOverUnranked(e: React.DragEvent) {
    e.preventDefault();
  }
  async function handleDropUnranked(e: React.DragEvent) {
    e.preventDefault();
    if (dragItem.current === null) return;
    const ticketId = dragItem.current;
    dragItem.current = null;
    dragOverItem.current = null;
    if (ticketId) {
      await handleRemoveFromRanking(ticketId);
    }
  }
  function handleDragEnter(ticketId: number) {
    dragOverItem.current = ticketId;
  }
  async function handleDragEnd() {
    if (dragItem.current === null || dragOverItem.current === null) {
      dragItem.current = null;
      dragOverItem.current = null;
      dragUnrankedTicket.current = null;
      return;
    }
    if (dragItem.current === dragOverItem.current) {
      dragItem.current = null;
      dragOverItem.current = null;
      dragUnrankedTicket.current = null;
      return;
    }
    if (mutationInFlightRef.current) return;

    const sourceTicketId = dragItem.current;
    const targetTicketId = dragOverItem.current;

    const sourceIndex = rankings.findIndex(r => r.ticketId === sourceTicketId);
    const targetIndex = rankings.findIndex(r => r.ticketId === targetTicketId);
    if (sourceIndex === -1 || targetIndex === -1) return;

    mutationInFlightRef.current = true;
    const prevRankings = [...rankings];
    const reorderedRankings = [...rankings].sort((a, b) => a.rankPosition - b.rankPosition);
    const draggedItem = reorderedRankings.splice(sourceIndex, 1)[0];
    if (!draggedItem) return;
    reorderedRankings.splice(targetIndex, 0, draggedItem);
    const newRankings = reorderedRankings.map((ranking, index) => ({ ...ranking, rankPosition: index + 1 }));

    setRankings(newRankings);

    try {
      const res = await fetch(`/api/rankings/${sourceTicketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPosition: targetIndex + 1, ownerUserId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Error al cambiar posición.', 'error');
        setRankings(prevRankings);
      } else {
        showToast('Prioridad actualizada', 'success');
      }
    } finally {
      dragItem.current = null;
      dragOverItem.current = null;
      dragUnrankedTicket.current = null;
      mutationInFlightRef.current = false;
      fetchRankings();
    }
  }

  async function saveOrder(orderedRankings: RankingEntry[]): Promise<boolean> {
    setSaving(true);
    try {
      const res = await fetch('/api/rankings/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderedTicketIds: orderedRankings.map((r) => r.ticketId),
          ownerUserId
        }),
      });

      const data = await res.json();
      if (res.ok) {
        if (data.changed !== false) {
          showToast('Nueva priorización guardada', 'success');
        }
        return true;
      } else {
        showToast(data.error || 'Error al guardar.', 'error');
        return false;
      }
    } catch {
      showToast('Error de conexión.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAddToRanking(ticket: TicketData) {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setSaving(true);

    try {
      const res = await fetch(`/api/rankings/${ticket.ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPosition: rankings.length + 1, ownerUserId }),
      });

      const data = await res.json();
      if (res.ok) {
        showToast('Nueva priorización guardada', 'success');
      } else {
        showToast(data.error || 'Error.', 'error');
      }
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      mutationInFlightRef.current = false;
      setSaving(false);
      fetchRankings();
    }
  }

  async function handleEditPosition(ticketId: number, newPosition: number) {
    if (mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setSaving(true);

    try {
      const res = await fetch(`/api/rankings/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPosition, ownerUserId }),
      });

      const data = await res.json();
      if (res.ok) {
        showToast('Prioridad actualizada', 'success');
      } else {
        showToast(data.error || 'Error.', 'error');
      }
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      mutationInFlightRef.current = false;
      setSaving(false);
      fetchRankings();
    }
  }

  if (viewFilter === 'open' && loading && rankings.length === 0 && unranked.length === 0 && !errorState) {
    return (
      <div className="loading-state">
        <div className="spinner spinner-lg"></div>
        <p>Cargando ranking...</p>
      </div>
    );
  }

  if (errorState) {
    return (
      <div style={{ padding: '24px' }}>
        <div className="empty-state" style={{ border: '2px solid var(--accent-danger)' }}>
          <div className="empty-state-icon">⚠️</div>
          <div className="empty-state-title">Error</div>
          <div className="empty-state-text">{errorState}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">🏆 Bandeja Priorizada</h1>
            <p className="page-subtitle">Arrastrá tickets para reordenar la lista priorizada</p>
          </div>
        </div>
      </div>

      <div className="page-body dashboard-main">
        {/* Filters and Chips */}
        <div className="filters-bar" style={{ flexWrap: 'wrap', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
          <div className="view-selector" style={{ display: 'flex', gap: '0.5rem' }}>
            <button className={`btn btn-sm ${viewFilter === 'open' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setViewFilter('open'); setSearch(''); setStatusFilter(''); setHistoryPage(1); }}>Activos</button>
            <button className={`btn btn-sm ${viewFilter === 'history' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setViewFilter('history'); setSearch(''); setStatusFilter(''); setHistoryPage(1); }}>Cerrados/Resueltos</button>
            <button className={`btn btn-sm ${viewFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setViewFilter('all'); setSearch(''); setStatusFilter(''); setHistoryPage(1); }}>Todos</button>
          </div>
          {viewFilter !== 'open' && (
            <>
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
                      setHistoryPage(1);
                      fetchHistoryTickets();
                    }
                  }}
                />
              </div>
              <select
                className="form-input"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setHistoryPage(1);
                }}
              >
                <option value="">Todos los estados</option>
                {viewFilter === 'all' && (
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
              <button className="btn btn-secondary btn-sm" onClick={() => { setHistoryPage(1); fetchHistoryTickets(); }}>
                Buscar
              </button>
            </>
          )}
        </div>

        {viewFilter === 'open' ? (
          <>
            {saving && (
              <div className="flex items-center gap-2" style={{ marginBottom: '12px', color: 'var(--accent-warning)', fontSize: '0.85rem' }}>
                <span className="spinner"></span> Guardando...
              </div>
            )}

            {/* Unified inbox: sector identity is retained on each ticket. */}
                  <div
                    className="priorizador-two-column-layout"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 0.85fr) minmax(0, 1.15fr)',
                      gap: '16px',
                      alignItems: 'stretch',
                      width: '100%',
                    }}
                  >
                    {/* LEFT: Unranked tickets drop-zone */}
                    <section className="priorizador-column priorizador-column-unranked" style={{ minWidth: 0, width: '100%' }}>
                      <div className="card" onDragOver={handleDragOverUnranked} onDrop={handleDropUnranked} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <div className="card-header" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)' }}>
                          <div>
                            <div className="card-title">Tickets sin priorizar ({unrankedTotal})</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>Arrastrá tickets priorizados aquí para quitarles prioridad.</div>
                          </div>
                        </div>
                        <div className="card-body ticket-list-body" style={{ flex: 1, paddingRight: '4px' }}>
                          {unranked.length === 0 ? (
                            <div className="empty-state"><div className="empty-state-icon">✅</div><div className="empty-state-title">Todos los tickets están priorizados</div></div>
                          ) : (
                            <div className="ticket-list">
                              {unranked.map((t) => (
                                <div key={t.ticketId} className="ticket-item" style={{ cursor: 'grab' }} draggable onDragStart={() => handleDragStartUnranked(t)}>
                                  <span className="ticket-drag-handle" style={{ cursor: 'grab' }}>⠿</span>
                                  <div className="ticket-info" style={{ paddingLeft: '8px' }}>
                                    <div className="ticket-info-header">
                                      <a className="ticket-id" href={t.webUrl} data-audit-ticket-id={t.ticketId} target="_blank" rel="noopener noreferrer">#{t.ticketId}</a>
                                      <span className={`badge ${STATUS_BADGE_MAP[t.statusLabel] || 'badge-nuevo'}`}>{t.statusLabel}</span>
                                      <span className="badge" style={{ background: 'var(--bg-panel)' }}>{t.detectedSector}</span>
                                    </div>
                                    <div className="ticket-title">{t.title}</div>
                                    <div className="ticket-meta">
                                      <span>👤 {t.requesterName || '—'}</span>
                                      <span>🏢 {t.detectedSector}</span>
                                      {t.typeLabel && <span>Tipo: {t.typeLabel}</span>}
                                    </div>
                                    {t.coordination && (
                                      <div style={{ marginTop: '12px' }}>
                                        <div className="flex items-center gap-2" style={{ marginBottom: '4px' }}>
                                          <div className="progress-bar" style={{ width: '60px' }}><div className="progress-fill" style={{ width: `${t.coordination.progressPercent}%` }}></div></div>
                                          <span className="progress-text">{t.coordination.progressPercent}%</span>
                                        </div>
                                        <CoordinatorComment text={t.coordination.coordinatorComment} />
                                        {t.coordination.estimatedDeliveryDate && (
                                          <div style={{ fontSize: '0.75rem', color: 'var(--accent-warning)', marginTop: '4px' }}>📅 TPR: {formatDate(t.coordination.estimatedDeliveryDate)}</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <button className="btn btn-primary btn-sm" onClick={() => handleAddToRanking(t)} disabled={saving} title="Agregar al ranking">+ Agregar</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {unrankedPages > 1 && (
                          <div className="card-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={unrankedPage === 1 || loading}
                              onClick={() => setUnrankedPage((page) => Math.max(1, page - 1))}
                            >
                              Anterior
                            </button>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                              Página {unrankedPage} de {unrankedPages}
                            </span>
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={unrankedPage === unrankedPages || loading}
                              onClick={() => setUnrankedPage((page) => Math.min(unrankedPages, page + 1))}
                            >
                              Siguiente
                            </button>
                          </div>
                        )}
                      </div>
                    </section>

                    {/* RIGHT: Ranked tickets */}
                    <section className="priorizador-column priorizador-column-ranked" style={{ minWidth: 0, width: '100%' }}>
                      <div className="card" onDragOver={handleDragOverRanked} onDrop={handleDropOnRanked} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <div className="card-header" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)' }}>
                          <div>
                            <div className="card-title">Tickets priorizados ({rankings.length})</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>Una única prioridad para toda tu bandeja.</div>
                          </div>
                        </div>
                        <div className="card-body ranking-card-body" style={{ flex: 1, paddingRight: '4px' }}>
                          {rankings.length === 0 ? (
                            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', border: '2px dashed var(--border)', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: '200px' }}>
                              🎯 Arrastrá tickets aquí o usá el botón <strong>+ Agregar</strong> de la izquierda.
                            </div>
                          ) : (
                            <div className="ticket-list">
                              {rankings.map((r) => (
                                <div key={r.ticketId} className="ticket-item" draggable onDragStart={() => handleDragStart(r.ticketId)} onDragEnter={() => handleDragEnter(r.ticketId)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()}>
                                  <EditablePriorityBadge currentPosition={r.rankPosition} ticketId={r.ticketId} maxPosition={rankings.length} onSave={handleEditPosition} />
                                  <span className="ticket-drag-handle">⠿</span>
                                  <div className="ticket-info">
                                    <div className="ticket-info-header">
                                      <a className="ticket-id" href={r.ticket.webUrl} data-audit-ticket-id={r.ticketId} target="_blank" rel="noopener noreferrer">#{r.ticketId}</a>
                                      <span className={`badge ${STATUS_BADGE_MAP[r.ticket.statusLabel] || 'badge-nuevo'}`}>{r.ticket.statusLabel}</span>
                                      <span className="badge" style={{ background: 'var(--bg-panel)' }}>{r.sectorName}</span>
                                    </div>
                                    <div className="ticket-title">{r.ticket.title}</div>
                                    <div className="ticket-meta">
                                      <span>👤 {r.ticket.requesterName || '—'}</span>
                                      <span>🏢 {r.ticket.detectedSector}</span>
                                      {r.ticket.typeLabel && <span>Tipo: {r.ticket.typeLabel}</span>}
                                      <span>🔧 {r.ticket.assignedTechnician || '—'}</span>
                                      <span title="Último priorizador">🎯 Priorizado por {r.prioritySetBy}</span>
                                    </div>
                                    {r.ticket.coordination && (
                                      <div style={{ marginTop: '12px' }}>
                                        <div className="flex items-center gap-2" style={{ marginBottom: '4px' }}>
                                          <div className="progress-bar" style={{ width: '60px' }}><div className="progress-fill" style={{ width: `${r.ticket.coordination.progressPercent}%` }}></div></div>
                                          <span className="progress-text">{r.ticket.coordination.progressPercent}%</span>
                                        </div>
                                        <CoordinatorComment text={r.ticket.coordination.coordinatorComment} />
                                        {r.ticket.coordination.estimatedDeliveryDate && (
                                          <div style={{ fontSize: '0.75rem', color: 'var(--accent-warning)', marginTop: '4px' }}>📅 TPR: {formatDate(r.ticket.coordination.estimatedDeliveryDate)}</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <button className="btn btn-secondary btn-sm" style={{ marginLeft: '12px', padding: '4px 8px', alignSelf: 'center', background: 'none', border: 'none', color: 'var(--accent-danger)' }} onClick={() => handleRemoveFromRanking(r.ticketId)} disabled={saving} title="Quitar de prioridad">✕</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </section>
                  </div>
          </>
        ) : (
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">
                {viewFilter === 'history' ? 'Tickets Cerrados/Resueltos' : 'Todos los Tickets'} ({historyTotal})
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Solo lectura</span>
            </div>
            <div className="card-body">
              {loadingHistory ? (
                <div className="loading-state">
                  <div className="spinner spinner-lg"></div>
                  <p>Cargando tickets...</p>
                </div>
              ) : historyTickets.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📋</div>
                  <div className="empty-state-title">Sin tickets</div>
                  <div className="empty-state-text">No se encontraron tickets en esta vista.</div>
                </div>
              ) : (
                <div className="ticket-list">
                  {historyTickets.map((t) => (
                    <div key={t.ticketId} className="ticket-item" style={{ cursor: 'default' }}>
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
                          <span className="badge" style={{ background: 'var(--bg-panel)' }}>
                            {t.detectedSector}
                          </span>
                        </div>
                        <div className="ticket-title">{t.title}</div>
                        <div className="ticket-meta">
                          <span>👤 {t.requesterName || '—'}</span>
                          <span>🏢 {t.detectedSector}</span>
                          {t.typeLabel && <span>Tipo: {t.typeLabel}</span>}
                          <span>🔧 {t.assignedTechnician || '—'}</span>
                        </div>
                        {t.coordination?.coordinatorComment && (
                          <CoordinatorComment text={t.coordination.coordinatorComment} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {historyPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '1rem', gap: '0.5rem' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage <= 1 || loadingHistory}
                  >
                    Anterior
                  </button>
                  <span style={{ fontSize: '0.9rem' }}>
                    Página {historyPage} de {historyPages}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setHistoryPage((p) => Math.min(historyPages, p + 1))}
                    disabled={historyPage >= historyPages || loadingHistory}
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="toast-container toast-centered">
          <div className={`toast toast-${toast.type} toast-fadeIn`}>{toast.message}</div>
        </div>
      )}
    </>
  );
}
