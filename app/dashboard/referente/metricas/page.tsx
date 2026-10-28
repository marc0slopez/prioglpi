'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer
} from 'recharts';
import { formatDateRange } from '@/lib/formatDate';
import DrillDownTicketList, { DrillDownFilters } from '@/app/components/DrillDownTicketList';
import DateStringInput from '@/app/components/DateStringInput';

interface DualKpi {
  misSectores: number;
  general: number;
}

interface MetricsData {
  kpis: {
    ingresados: DualKpi;
    cerrados: DualKpi;
    backlog: DualKpi;
    conRanking: DualKpi;
    sinRanking: DualKpi;
  };
  bySector: { name: string; count: number; id: number | null }[];
  byStatus: { label: string; count: number; id: number }[];
  byRequester: { name: string; count: number; id: number | null }[];
  byTechnician: { name: string; count: number; id: number | null }[];
  periodRange: { start: string; end: string };
}

const COLORS = ['#3b82f6', '#14b8a6', '#eab308', '#f97316', '#8b5cf6', '#ec4899'];

function KpiBox({ label, data }: { label: string, data?: DualKpi }) {
  const misSectores = data?.misSectores || 0;
  const general = data?.general || 0;

  return (
    <div style={{
      background: 'var(--bg-glass)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      padding: '14px'
    }}>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--accent-primary)', lineHeight: 1 }}>{misSectores}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>Mi sector</div>
        </div>
        <div style={{ width: '1px', height: '30px', background: 'var(--border)' }}></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{general}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>General</div>
        </div>
      </div>
    </div>
  );
}

export default function ReferenteMetricsPage() {
  const [metricsPeriod, setMetricsPeriod] = useState('month');
  const [drillDown, setDrillDown] = useState<DrillDownFilters | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const listRef = useRef<HTMLDivElement>(null);

  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [metricsError, setMetricsError] = useState(false);

  const metricsAbortControllerRef = useRef<AbortController | null>(null);

  const fetchMetrics = useCallback(async () => {
    if (metricsPeriod === 'custom' && (!startDate || !endDate)) return;

    if (metricsAbortControllerRef.current) {
      metricsAbortControllerRef.current.abort();
    }
    const metricsController = new AbortController();
    metricsAbortControllerRef.current = metricsController;

    setLoadingMetrics(true);
    setMetricsError(false);

    try {
      const params = new URLSearchParams();
      params.set('period', metricsPeriod);
      if (metricsPeriod === 'custom') {
        params.set('startDate', startDate);
        params.set('endDate', endDate);
      }

      if (drillDown) {
        if (drillDown.type === 'sector' && drillDown.id !== null) params.set('sectorGroupId', drillDown.id.toString());
        if (drillDown.type === 'status' && drillDown.id !== null) params.set('status', drillDown.id.toString());
        if (drillDown.type === 'requester' && drillDown.id !== null) params.set('requesterId', drillDown.id.toString());
        if (drillDown.type === 'technician' && drillDown.name === 'Soporte Dycos') params.set('soporteDycos', 'true');
        else if (drillDown.type === 'technician' && drillDown.id !== null) params.set('technicianId', drillDown.id.toString());
      }

      const res = await fetch(`/api/metrics/referent?${params.toString()}`, {
        signal: metricsController.signal
      });

      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      } else {
        setMetricsError(true);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setMetricsError(true);
    } finally {
      setLoadingMetrics(false);
    }
  }, [metricsPeriod, startDate, endDate, drillDown]);

  useEffect(() => {
    setDrillDown(null);
  }, [metricsPeriod, startDate, endDate]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    if (drillDown && listRef.current) {
      listRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [drillDown]);

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">📊 Métricas - Referente</h1>
            <p className="page-subtitle">Indicadores de rendimiento de tu sector</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'var(--bg-glass)', borderRadius: '12px' }}>
          <div className="metrics-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginBottom: '20px' }}>
            <select className="form-input" style={{ width: 'auto' }} value={metricsPeriod} onChange={e => setMetricsPeriod(e.target.value)}>
              <option value="day">Hoy</option>
              <option value="week">Esta Semana</option>
              <option value="month">Este Mes</option>
              <option value="year">Este Año</option>
              <option value="custom">Personalizado</option>
            </select>

            {metricsPeriod === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0 10px', height: '38px' }}>
                <DateStringInput value={startDate} onChange={setStartDate} />
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>a</span>
                <DateStringInput value={endDate} onChange={setEndDate} />
              </div>
            )}

            {metrics && !loadingMetrics && metricsPeriod !== 'custom' && (
              <span className="metrics-period-range">
                ({formatDateRange(metrics.periodRange?.start, metrics.periodRange?.end)})
              </span>
            )}
          </div>

          {loadingMetrics ? (
            <div style={{ padding: '2rem', textAlign: 'center' }}>
              <span className="spinner"></span> Cargando métricas...
            </div>
          ) : metricsError ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--accent-danger)' }}>
              Error al cargar las métricas. Compruebe los filtros e intente nuevamente.
            </div>
          ) : !metrics ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-title">Sin datos</div>
              <div className="empty-state-text">No hay tickets ingresados en este período.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '12px', marginBottom: '22px' }}>
                <KpiBox label="Ingresados" data={metrics.kpis?.ingresados} />
                <KpiBox label="Cerrados" data={metrics.kpis?.cerrados} />
                <KpiBox label="Backlog activo" data={metrics.kpis?.backlog} />
                <KpiBox label="Con prioridad" data={metrics.kpis?.conRanking} />
                <KpiBox label="Sin prioridad" data={metrics.kpis?.sinRanking} />
              </div>

              {metrics.kpis?.ingresados?.general === 0 && metrics.kpis?.backlog?.general === 0 ? (
                <div className="empty-state" style={{ padding: '2rem 0' }}>
                  <div className="empty-state-icon">📈</div>
                  <div className="empty-state-title">Sin actividad en este período</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <div className="chart-card" style={{ background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                    <h3 className="mb-4 text-center text-sm font-semibold">Tickets por estado</h3>
                    <div className="chart-canvas" style={{ height: '230px' }}>
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
                          >
                            {metrics.byStatus?.map((entry, index) => {
                              const isSelected = drillDown?.type === 'status' && drillDown.id === entry.id;
                              return (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={COLORS[index % COLORS.length]}
                                  style={{ cursor: 'pointer', outline: 'none', opacity: drillDown?.type === 'status' && !isSelected ? 0.3 : 1 }}
                                  onClick={() => setDrillDown(prev => prev?.type === 'status' && prev.id === entry.id ? null : { type: 'status', id: entry.id, name: entry.label })}
                                />
                              )
                            })}
                          </Pie>
                          <RechartsTooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="chart-card" style={{ background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                    <h3 className="mb-4 text-center text-sm font-semibold">Tickets por sector</h3>
                    <div className="chart-canvas" style={{ height: '230px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={metrics.bySector}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                          <XAxis dataKey="name" tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                          <YAxis axisLine={false} tickLine={false} />
                          <RechartsTooltip cursor={{fill: 'rgba(255, 255, 255, 0.05)'}} />
                          <Bar
                            dataKey="count"
                            fill="var(--accent-primary)"
                            radius={[4, 4, 0, 0]}
                            barSize={40}
                          >
                            {metrics.bySector?.map((entry, index) => {
                              const isSelected = drillDown?.type === 'sector' && drillDown.id === entry.id;
                              return (
                                <Cell
                                  key={`cell-${index}`}
                                  fill="var(--accent-primary)"
                                  style={{ cursor: 'pointer', outline: 'none', opacity: drillDown?.type === 'sector' && !isSelected ? 0.3 : 1 }}
                                  onClick={() => setDrillDown(prev => prev?.type === 'sector' && prev.id === entry.id ? null : { type: 'sector', id: entry.id, name: entry.name })}
                                />
                              );
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="chart-card" style={{ background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                    <h3 className="mb-4 text-left text-sm font-semibold">Tickets por solicitante</h3>
                    <div className="chart-canvas" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      <ResponsiveContainer width="100%" height={Math.max(230, (metrics.byRequester?.length || 0) * 44)}>
                        <BarChart data={metrics.byRequester} layout="vertical" margin={{ left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                          <XAxis type="number" axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="name" tick={{fontSize: 11}} axisLine={false} tickLine={false} width={120} interval={0} />
                          <RechartsTooltip cursor={{fill: 'rgba(255, 255, 255, 0.05)'}} />
                          <Bar
                            dataKey="count"
                            fill="#3b82f6"
                            radius={[0, 4, 4, 0]}
                            barSize={20}
                          >
                            {metrics.byRequester?.map((entry, index) => {
                              const isSelected = drillDown?.type === 'requester' && drillDown.id === entry.id;
                              return (
                                <Cell
                                  key={`cell-${index}`}
                                  fill="#3b82f6"
                                  style={{ cursor: 'pointer', outline: 'none', opacity: drillDown?.type === 'requester' && !isSelected ? 0.3 : 1 }}
                                  onClick={() => setDrillDown(prev => prev?.type === 'requester' && prev.id === entry.id ? null : { type: 'requester', id: entry.id, name: entry.name })}
                                />
                              );
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="chart-card" style={{ background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                    <h3 className="mb-4 text-left text-sm font-semibold">Tickets por técnico</h3>
                    <div className="chart-canvas" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      <ResponsiveContainer width="100%" height={Math.max(230, (metrics.byTechnician?.length || 0) * 44)}>
                        <BarChart data={metrics.byTechnician} layout="vertical" margin={{ left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                          <XAxis type="number" axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="name" tick={{fontSize: 11}} axisLine={false} tickLine={false} width={120} interval={0} />
                          <RechartsTooltip cursor={{fill: 'rgba(255, 255, 255, 0.05)'}} />
                          <Bar
                            dataKey="count"
                            fill="#14b8a6"
                            radius={[0, 4, 4, 0]}
                            barSize={20}
                          >
                            {metrics.byTechnician?.map((entry, index) => {
                              const isSelected = drillDown?.type === 'technician' && drillDown.id === entry.id;
                              return (
                                <Cell
                                  key={`cell-${index}`}
                                  fill="#14b8a6"
                                  style={{ cursor: 'pointer', outline: 'none', opacity: drillDown?.type === 'technician' && !isSelected ? 0.3 : 1 }}
                                  onClick={() => setDrillDown(prev => prev?.type === 'technician' && prev.id === entry.id ? null : { type: 'technician', id: entry.id, name: entry.name })}
                                />
                              );
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                </div>
              )}

              <div ref={listRef}>
                {drillDown && (
                  <DrillDownTicketList
                    drillDown={drillDown}
                    period={metricsPeriod}
                    startDate={metricsPeriod === 'custom' ? startDate : undefined}
                    endDate={metricsPeriod === 'custom' ? endDate : undefined}
                    sectorGroupId={'todos'}
                    onClear={() => setDrillDown(null)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
