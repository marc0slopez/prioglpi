'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { formatDate, formatDateRange } from '@/lib/formatDate';
import { TicketGlpiFacts, TicketGlpiFollowup, type TicketGlpiSummaryData } from '@/app/components/TicketGlpiSummary';

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
  webUrl: string;
  glpiSummary?: TicketGlpiSummaryData;
  rankings: { rankPosition: number; sectorName: string }[];
  coordination: {
    progressPercent: number;
    coordinatorComment: string;
    estimatedDeliveryDate: string | null;
  } | null;
}

interface MetricsData {
  kpis: {
    ingresados: number;
    backlog: number;
    nuevos: number;
    enCurso: number;
    planificados: number;
    espera: number;
    resueltos: number;
    cerrados: number;
    conRanking: number;
    avancePromedio: number;
    etaVencida: number | null;
  };
  byStatus: { label: string; count: number; id: number }[];
  byTechnician: { id: number | 'unassigned'; name: string; count: number }[];
  periodRange: { start: string; end: string };
}

interface ReferentOption {
  id: number;
  displayName: string;
  glpiUserId: number | null;
  groups: { glpiGroupId: number; sectorName: string }[];
  isActive: boolean;
}

const STATUS_BADGE_MAP: Record<string, string> = {
  'Nuevo': 'badge-nuevo',
  'En curso': 'badge-encurso',
  'Planificado': 'badge-planificado',
  'En espera': 'badge-enespera',
  'Resuelto': 'badge-resuelto',
  'Cerrado': 'badge-cerrado',
};

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#a28bfe', '#fd79a8'];

export default function CoordinadorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [tickets, setTickets] = useState<TicketFull[]>([]);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);

  // E4: Core bandeja filters — NO period by default
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [searchId, setSearchId] = useState(searchParams.get('ticketId') || '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '');
  const [viewFilter, setViewFilter] = useState(searchParams.get('view') || 'open');
  const [priorityFilter, setPriorityFilter] = useState(searchParams.get('priority') || 'all');
  const [referentFilter, setReferentFilter] = useState(searchParams.get('referentUserId') || 'all');

  // E4: Metrics period — separate from bandeja
  const [metricsPeriod, setMetricsPeriod] = useState('month');

  // E4: Drill-down state — activated only by clicking metrics
  const [drillFrom, setDrillFrom] = useState<string | null>(null);
  const [drillToExclusive, setDrillToExclusive] = useState<string | null>(null);
  const [chartStatusFilter, setChartStatusFilter] = useState<number | null>(null);
  const [chartTechFilter, setChartTechFilter] = useState<string | null>(null);

  // Advanced Filters
  // techFilter: '' = todos, 'soporte-dycos' = filtro Soporte Dycos, '<number>' = glpi_user_id
  const [techFilter, setTechFilter] = useState(() => {
    if (searchParams.get('soporteDycos') === 'true') return 'soporte-dycos';
    return searchParams.get('technicianId') || '';
  });
  const [sectorFilter, setSectorFilter] = useState(searchParams.get('sectorGroupId') || '');
  const [requesterFilter, setRequesterFilter] = useState(searchParams.get('requesterId') || '');
  const [notesFilter, setNotesFilter] = useState(searchParams.get('notes') || '');
  const [commentsFilter, setCommentsFilter] = useState(searchParams.get('comments') || '');

  // Options
  const [filterOptions, setFilterOptions] = useState<{
    technicians: { id: number; name: string }[];
    sectors: { id: number; name: string }[];
    requesters: { id: number; name: string }[];
    referentOptions: ReferentOption[];
  }>({ technicians: [], sectors: [], requesters: [], referentOptions: [] });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [totalTickets, setTotalTickets] = useState(0);
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10));
  const [totalPages, setTotalPages] = useState(1);
  const [showMetrics, setShowMetrics] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(true);

  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Dataset visual para gráfico de técnicos: solo count > 0, sin mutar el array original
  const positiveTechnicianData = useMemo(() =>
    [...(metrics?.byTechnician ?? [])]
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
  [metrics?.byTechnician]
  );
  const techChartHeight = Math.max(120, positiveTechnicianData.length * 44);

  useEffect(() => {
    fetch('/api/meta/ticket-filters')
      .then(res => res.json())
      .then(data => {
        if (!data.error) setFilterOptions(data);
      })
      .catch(console.error);

    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        setIsReadOnly(data?.role !== 'coordinador_sistemas');
      })
      .catch(console.error);
  }, []);

  const isDrillActive = drillFrom !== null || chartStatusFilter !== null || chartTechFilter !== null;

  const fetchData = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    setLoading(true);
    try {
      // Build ticket list params — NO implicit period
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (searchId) params.set('ticketId', searchId);
      if (sectorFilter) params.set('sectorGroupId', sectorFilter);
      if (requesterFilter) params.set('requesterId', requesterFilter);
      if (notesFilter) params.set('notes', notesFilter);
      if (commentsFilter) params.set('comments', commentsFilter);

      params.set('view', viewFilter);
      params.set('priority', isDrillActive ? 'all' : priorityFilter);

      if (referentFilter && referentFilter !== 'all') {
        params.set('referentUserId', referentFilter);
      }

      // E4: Drill-down dates only when active
      if (drillFrom) params.set('from', drillFrom);
      if (drillToExclusive) params.set('toExclusive', drillToExclusive);

      const effectiveStatus = chartStatusFilter !== null ? chartStatusFilter.toString() : statusFilter;
      if (effectiveStatus) params.set('status', effectiveStatus);

      let effectiveTech = techFilter;
      let isUnassigned = false;
      let isSoporteDycos = false;
      if (chartTechFilter !== null) {
        if (chartTechFilter === 'Sin asignar') {
          isUnassigned = true;
          effectiveTech = '';
        } else if (chartTechFilter === 'Soporte Dycos') {
          isSoporteDycos = true;
          effectiveTech = '';
        } else {
          const found = filterOptions.technicians.find(t => t.name === chartTechFilter);
          if (found) {
            effectiveTech = found.id.toString();
          }
        }
      } else if (techFilter === 'soporte-dycos') {
        isSoporteDycos = true;
        effectiveTech = '';
      }

      if (effectiveTech && effectiveTech !== 'soporte-dycos') params.set('technicianId', effectiveTech);
      if (isUnassigned) params.set('unassignedTechnician', 'true');
      if (isSoporteDycos) params.set('soporteDycos', 'true');

      params.set('page', currentPage.toString());

      const query = params.toString() ? `?${params.toString()}` : '';

      // Metrics params — uses metricsPeriod independently
      const mParams = new URLSearchParams();
      mParams.set('period', metricsPeriod);
      mParams.set('view', viewFilter);
      if (effectiveStatus) mParams.set('status', effectiveStatus);
      if (effectiveTech && effectiveTech !== 'soporte-dycos') mParams.set('technicianId', effectiveTech);
      if (isUnassigned) mParams.set('unassignedTechnician', 'true');
      if (isSoporteDycos) mParams.set('soporteDycos', 'true');

      const [ticketsRes, metricsRes] = await Promise.all([
        fetch(`/api/tickets${query}`, { signal }),
        fetch(`/api/metrics/coordinator?${mParams.toString()}`, { signal }),
      ]);

      if (ticketsRes.ok) {
        const data = await ticketsRes.json();
        // E4: Tickets come pre-ordered from backend; no client-side re-sort needed
        setTickets(data.tickets || []);
        setTotalTickets(data.total || 0);
        setTotalPages(data.pages || 1);
      }
      if (metricsRes.ok) {
        setMetrics(await metricsRes.json());
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        showToast('Error al cargar datos.', 'error');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, [search, searchId, techFilter, sectorFilter, requesterFilter, notesFilter, commentsFilter, statusFilter, viewFilter, priorityFilter, referentFilter, metricsPeriod, currentPage, chartStatusFilter, chartTechFilter, drillFrom, drillToExclusive, filterOptions.technicians, isDrillActive]);

  // URL Synchronization
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (searchId) params.set('ticketId', searchId);
    if (sectorFilter) params.set('sectorGroupId', sectorFilter);
    if (requesterFilter) params.set('requesterId', requesterFilter);
    if (notesFilter) params.set('notes', notesFilter);
    if (commentsFilter) params.set('comments', commentsFilter);

    params.set('view', viewFilter);
    params.set('priority', isDrillActive ? 'all' : priorityFilter);

    if (referentFilter && referentFilter !== 'all') {
      params.set('referentUserId', referentFilter);
    }

    if (drillFrom) params.set('from', drillFrom);
    if (drillToExclusive) params.set('toExclusive', drillToExclusive);

    const effectiveStatus = chartStatusFilter !== null ? chartStatusFilter.toString() : statusFilter;
    if (effectiveStatus) params.set('status', effectiveStatus);

    let effectiveTech = techFilter;
    let isUnassigned = false;
    let isSoporteDycos = false;
    if (chartTechFilter !== null) {
      if (chartTechFilter === 'Sin asignar') {
        isUnassigned = true;
        effectiveTech = '';
      } else if (chartTechFilter === 'Soporte Dycos') {
        isSoporteDycos = true;
        effectiveTech = '';
      } else {
        const found = filterOptions.technicians.find(t => t.name === chartTechFilter);
        if (found) {
          effectiveTech = found.id.toString();
        }
      }
    } else if (techFilter === 'soporte-dycos') {
      isSoporteDycos = true;
      effectiveTech = '';
    }

    if (effectiveTech && effectiveTech !== 'soporte-dycos') params.set('technicianId', effectiveTech);
    if (isUnassigned) params.set('unassignedTechnician', 'true');
    if (isSoporteDycos) params.set('soporteDycos', 'true');

    params.set('page', currentPage.toString());

    const currentParams = new URLSearchParams(searchParams.toString());
    const keys = ['search', 'ticketId', 'technicianId', 'soporteDycos', 'sectorGroupId', 'requesterId', 'notes', 'comments', 'status', 'view', 'priority', 'referentUserId', 'from', 'toExclusive', 'page', 'unassignedTechnician'];
    keys.forEach(k => currentParams.delete(k));
    for (const [k, v] of params.entries()) currentParams.set(k, v);

    const newQueryString = currentParams.toString();
    if (newQueryString !== searchParams.toString()) {
      router.replace(`${pathname}?${newQueryString}`, { scroll: false });
    }
  }, [search, searchId, techFilter, sectorFilter, requesterFilter, notesFilter, commentsFilter, statusFilter, viewFilter, priorityFilter, referentFilter, currentPage, chartStatusFilter, chartTechFilter, drillFrom, drillToExclusive, filterOptions.technicians, isDrillActive, searchParams, pathname, router]);

  // Debounced fetch
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      fetchData();
    }, 300);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [fetchData]);

  // E4: Clicking a chart applies drill-down with period dates
  const handleStatusClick = useCallback((id: number) => {
    setChartStatusFilter(prev => {
      const next = prev === id ? null : id;
      if (next === null && chartTechFilter === null) {
        setDrillFrom(null);
        setDrillToExclusive(null);
      } else if (metrics?.periodRange) {
        setDrillFrom(metrics.periodRange.start);
        setDrillToExclusive(metrics.periodRange.end);
      }
      return next;
    });
    setCurrentPage(1);
  }, [metrics, chartTechFilter]);

  const handleTechClick = useCallback((name: string) => {
    setChartTechFilter(prev => {
      const next = prev === name ? null : name;
      if (next === null && chartStatusFilter === null) {
        setDrillFrom(null);
        setDrillToExclusive(null);
      } else if (metrics?.periodRange) {
        setDrillFrom(metrics.periodRange.start);
        setDrillToExclusive(metrics.periodRange.end);
      }
      return next;
    });
    setCurrentPage(1);
  }, [metrics, chartStatusFilter]);

  // E4: Clear drill-down returns to bandeja without dates, keeps manual filters
  const clearDrillDown = useCallback(() => {
    setChartStatusFilter(null);
    setChartTechFilter(null);
    setDrillFrom(null);
    setDrillToExclusive(null);
    setCurrentPage(1);
  }, []);

  const clearAllFilters = useCallback(() => {
    setViewFilter('open');
    setPriorityFilter('all');
    setReferentFilter('all');
    setSearch('');
    setSearchId('');
    setStatusFilter('');
    setSectorFilter('');
    setTechFilter('');
    setRequesterFilter('');
    setNotesFilter('');
    setCommentsFilter('');
    clearDrillDown();
  }, [clearDrillDown]);

  function showToast(message: string, type: string) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">📋 Bandeja Priorizada - Coordinador</h1>
            <p className="page-subtitle">Panel de control y metricas avanzadas</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Metrics Dashboard */}
        {showMetrics && metrics && (
          <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--bg-glass)', borderRadius: '12px' }}>
            <div className="metrics-toolbar">
              <h2 className="text-xl font-bold">Metricas de Rendimiento</h2>
              <select className="form-input" style={{ width: 'auto' }} value={metricsPeriod} onChange={e => setMetricsPeriod(e.target.value)}>
                <option value="day">Hoy</option>
                <option value="week">Esta Semana</option>
                <option value="month">Este Mes</option>
                <option value="year">Este Año</option>
              </select>
              <span className="metrics-period-range">
                ({formatDateRange(metrics.periodRange?.start, metrics.periodRange?.end)})
              </span>
            </div>

            <div className="metrics-grid mb-6">
              <div className="metric-card"><div className="metric-value">{metrics.kpis?.ingresados || 0}</div><div className="metric-label">Ingresados</div></div>
              <div className="metric-card" style={{borderColor: 'var(--accent-warning)'}}><div className="metric-value">{metrics.kpis?.backlog || 0}</div><div className="metric-label">Backlog Activo</div></div>
              <div className="metric-card"><div className="metric-value">{metrics.kpis?.conRanking || 0}</div><div className="metric-label">Priorizados</div></div>
              <div className="metric-card"><div className="metric-value">{metrics.kpis?.avancePromedio || 0}%</div><div className="metric-label">Progreso Promedio</div></div>
              <div className="metric-card" style={{borderColor: 'var(--accent-danger)'}}>
                <div className="metric-value" title={metrics.kpis?.etaVencida === null ? 'No se pudo consultar la TTR en GLPI' : undefined}>
                  {metrics.kpis?.etaVencida ?? '—'}
                </div>
                <div className="metric-label">TTR Vencida</div>
              </div>
            </div>

            <div className="charts-grid">
              <div className="chart-card">
                <h3 className="mb-2 text-center text-sm font-semibold">Tickets por Estado</h3>
                <div className="chart-canvas">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={metrics.byStatus}
                        dataKey="count"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label
                        style={{ cursor: 'pointer' }}
                      >
                        {metrics.byStatus.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={COLORS[index % COLORS.length]}
                            opacity={chartStatusFilter !== null && chartStatusFilter !== entry.id ? 0.3 : 1}
                            onClick={() => handleStatusClick(entry.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleStatusClick(entry.id);
                              }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Filtrar por estado ${entry.label}`}
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="chart-card">
                <h3 className="mb-2 text-center text-sm font-semibold">Tickets por Tecnico</h3>
                {/* Dataset visual: solo count > 0, ordenado desc count / asc name */}
                {positiveTechnicianData.length === 0 ? (
                  <div className="empty-state" style={{ padding: '1.5rem 0' }}>
                    <div className="empty-state-icon">📊</div>
                    <div className="empty-state-text">No hay tickets asignados para los filtros seleccionados.</div>
                  </div>
                ) : (
                  <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
                    <ResponsiveContainer width="100%" height={techChartHeight}>
                      <BarChart data={positiveTechnicianData} layout="vertical" margin={{ left: 0, right: 24, top: 4, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={220}
                          tick={{ fontSize: 12 }}
                          tickLine={false}
                        />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                        <RechartsTooltip />
                        <Bar
                          dataKey="count"
                          fill="var(--accent-primary)"
                          radius={[0, 4, 4, 0]}
                          style={{ cursor: 'pointer' }}
                        >
                          {positiveTechnicianData.map((entry) => (
                            <Cell
                              key={`tech-bar-${entry.id ?? entry.name}`}
                              opacity={chartTechFilter !== null && chartTechFilter !== entry.name ? 0.3 : 1}
                              onClick={() => handleTechClick(entry.name)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleTechClick(entry.name);
                                }
                              }}
                              tabIndex={0}
                              role="button"
                              aria-label={`Filtrar por tecnico ${entry.name}`}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {/* Lista textual conserva TODOS los técnicos, incluidos count=0 */}
                <div className="mt-4 text-sm" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {metrics.byTechnician.map((t) => (
                      <li key={t.id ?? t.name}>
                        <button
                          type="button"
                          className="metric-actor-button"
                          onClick={() => handleTechClick(t.name)}
                          aria-pressed={chartTechFilter === t.name}
                        >
                          <span>{t.name}</span>
                          <span className="badge badge-nuevo">{t.count}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* E4: Drill-down chips with clear button */}
            {isDrillActive && (
              <div className="chart-active-filters">
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Filtros activos:</span>
                {drillFrom && (
                  <span className="badge badge-nuevo">
                    Periodo: {formatDateRange(drillFrom, drillToExclusive || undefined)}
                  </span>
                )}
                {chartStatusFilter !== null && (
                  <span className="badge badge-encurso">
                    Estado: {metrics.byStatus.find(s => s.id === chartStatusFilter)?.label || chartStatusFilter}
                  </span>
                )}
                {chartTechFilter !== null && (
                  <span className="badge badge-planificado">
                    Tecnico: {chartTechFilter}
                  </span>
                )}
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={clearDrillDown}
                >
                  Limpiar filtros de graficos
                </button>
              </div>
            )}
          </div>
        )}

        {/* E4: Filters Bar with Priority and Referent selectors */}
        <div className="filters-bar" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', width: '100%', alignItems: 'center' }}>
            <div className="view-selector" style={{ display: 'flex', gap: '0.5rem' }}>
              <button className={`btn btn-sm ${viewFilter === 'open' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setViewFilter('open'); clearDrillDown(); setCurrentPage(1); }}>Abiertos</button>
              <button className={`btn btn-sm ${viewFilter === 'history' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setViewFilter('history'); clearDrillDown(); setCurrentPage(1); }}>Cerrados/Resueltos</button>
              <button className={`btn btn-sm ${viewFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setViewFilter('all'); clearDrillDown(); setCurrentPage(1); }}>Todos</button>
            </div>

            {/* E4: Priority selector */}
            <select
              className="form-input"
              style={{ width: 'auto', minWidth: '140px' }}
              value={priorityFilter}
              onChange={e => { setPriorityFilter(e.target.value); setCurrentPage(1); }}
            >
              <option value="ranked">Priorizados</option>
              <option value="unranked">Sin priorizar</option>
              <option value="all">Todos</option>
            </select>

            {/* E4: Referent selector */}
            <select
              className="form-input"
              style={{ width: 'auto', minWidth: '180px' }}
              value={referentFilter}
              onChange={e => { setReferentFilter(e.target.value); setCurrentPage(1); }}
            >
              <option value="all">Todos los priorizadores</option>
              {filterOptions.referentOptions.map(r => (
                <option key={r.id} value={r.id}>{r.displayName}</option>
              ))}
            </select>

            <div className="search-input-wrapper" style={{ flex: 1, minWidth: '200px' }}>
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="form-input"
                placeholder="Buscar en titulo, notas, tareas..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              />
            </div>
            <button className={`btn btn-sm ${showAdvanced ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowAdvanced(!showAdvanced)}>
              ⚙️ Avanzada
            </button>
          </div>

          {showAdvanced && (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '1rem', background: 'var(--bg-glass)', borderRadius: '8px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="ID exacto (#)"
                value={searchId}
                onChange={(e) => { setSearchId(e.target.value); setCurrentPage(1); }}
                style={{ width: '150px' }}
              />
              <select className="form-input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}>
                <option value="">Todos los estados</option>
                <option value="1">Nuevo</option>
                <option value="2">En curso</option>
                <option value="3">Planificado</option>
                <option value="4">En espera</option>
                <option value="5">Resuelto</option>
                <option value="6">Cerrado</option>
              </select>
              <select className="form-input" value={sectorFilter} onChange={(e) => { setSectorFilter(e.target.value); setCurrentPage(1); }}>
                <option value="">Todos los sectores</option>
                {filterOptions.sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select className="form-input" value={techFilter} onChange={(e) => { setTechFilter(e.target.value); setCurrentPage(1); }}>
                <option value="">Todos los tecnicos</option>
                <option value="soporte-dycos">Soporte Dycos</option>
                {filterOptions.technicians.filter(t => t.name !== 'Soporte Dycos').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select className="form-input" value={requesterFilter} onChange={(e) => { setRequesterFilter(e.target.value); setCurrentPage(1); }}>
                <option value="">Todos los solicitantes</option>
                {filterOptions.requesters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input
                type="text"
                className="form-input"
                placeholder="Buscar notas internas"
                value={notesFilter}
                onChange={(e) => { setNotesFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '150px' }}
              />
              <input
                type="text"
                className="form-input"
                placeholder="Comentarios"
                value={commentsFilter}
                onChange={(e) => { setCommentsFilter(e.target.value); setCurrentPage(1); }}
                style={{ width: '150px' }}
              />
            </div>
          )}
        </div>

        {/* Chips */}
        {(searchId || statusFilter || techFilter || sectorFilter || requesterFilter || notesFilter || commentsFilter || isDrillActive) && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {searchId && <span className="badge badge-nuevo" style={{ cursor: 'pointer' }} onClick={() => setSearchId('')}>ID: {searchId} ✖</span>}
            {statusFilter && <span className="badge badge-encurso" style={{ cursor: 'pointer' }} onClick={() => setStatusFilter('')}>Estado: {statusFilter} ✖</span>}
            {techFilter && <span className="badge badge-planificado" style={{ cursor: 'pointer' }} onClick={() => setTechFilter('')}>Tecnico: {techFilter === 'soporte-dycos' ? 'Soporte Dycos' : filterOptions.technicians.find(t => t.id.toString() === techFilter)?.name || techFilter} ✖</span>}
            {sectorFilter && <span className="badge badge-planificado" style={{ cursor: 'pointer' }} onClick={() => setSectorFilter('')}>Sector: {filterOptions.sectors.find(s => s.id.toString() === sectorFilter)?.name || sectorFilter} ✖</span>}
            {requesterFilter && <span className="badge badge-planificado" style={{ cursor: 'pointer' }} onClick={() => setRequesterFilter('')}>Solicitante: {filterOptions.requesters.find(r => r.id.toString() === requesterFilter)?.name || requesterFilter} ✖</span>}
            {notesFilter && <span className="badge badge-nuevo" style={{ cursor: 'pointer' }} onClick={() => setNotesFilter('')}>Notas internas: {notesFilter} ✖</span>}
            {commentsFilter && <span className="badge badge-nuevo" style={{ cursor: 'pointer' }} onClick={() => setCommentsFilter('')}>Comentarios: {commentsFilter} ✖</span>}
            {isDrillActive && (
              <span className="badge badge-encurso" style={{ cursor: 'pointer' }} onClick={clearDrillDown}>
                Drill-down activo ✖
              </span>
            )}
            <button className="btn btn-sm btn-secondary" onClick={clearAllFilters}>Limpiar todo</button>
          </div>
        )}

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
            <span style={{ fontSize: '0.9rem' }}>Pagina {currentPage} de {totalPages}</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Siguiente
            </button>
          </div>
        </div>

        {/* Ticket list */}
        {loading ? (
          <div className="loading-state">
            <div className="spinner spinner-lg"></div>
            <p>Cargando tickets...</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">Sin tickets</div>
            <div className="empty-state-text">No se encontraron tickets con los filtros actuales.</div>
          </div>
        ) : (
          <div className="ticket-list">
            {tickets.map((t) => (
              <div key={t.ticketId} className="ticket-item coordinator-ticket-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <div className="rank-badge" style={!t.rankings?.[0] ? { background: 'var(--bg-glass)', color: 'var(--text-muted)' } : {}}>
                  {t.rankings?.[0]?.rankPosition || '—'}
                </div>
                <div className="ticket-info-block">
                  <div className="ticket-info-header">
                    <a className="ticket-id" href={t.webUrl} data-audit-ticket-id={t.ticketId} target="_blank" rel="noopener noreferrer">
                      #{t.ticketId}
                    </a>
                    <span className={`badge ${STATUS_BADGE_MAP[t.statusLabel] || 'badge-nuevo'}`}>
                      {t.statusLabel}
                    </span>
                    {t.rankings?.[0] && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Sector: {t.rankings[0].sectorName}
                      </span>
                    )}
                  </div>
                  <div className="ticket-title">{t.title}</div>
                  <div className="ticket-meta">
                    <span>👤 {t.requesterName || '—'}</span>
                    <span>🏢 {t.detectedSector}</span>
                    {t.typeLabel && <span>Tipo: {t.typeLabel}</span>}
                    <span>🔧 {t.assignedTechnician || '—'}</span>
                    <span>📅 {t.openedAt ? formatDate(t.openedAt) : '—'}</span>
                  </div>
                  <TicketGlpiFacts summary={t.glpiSummary} status={t.status} />
                </div>

                <div className="ticket-coordination-block">
                  <TicketGlpiFollowup summary={t.glpiSummary} ticketId={t.ticketId}
                    canAdd={!isReadOnly && t.status < 5} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
      )}
    </>
  );
}
