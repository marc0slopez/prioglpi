'use client';

import React, { useEffect, useState, useCallback, Fragment } from 'react';
import { formatDateLong } from '@/lib/formatDate';

interface HealthData {
  glpi: { connected: boolean; error: string | null; baseUrl: string };
  sync: {
    lastSync: { startedAt: string; finishedAt: string | null; status: string; ticketsFetched: number; errorMessage: string | null } | null;
    totalCachedTickets: number;
    sistemasCachedTickets: number;
  };
}

interface UserData {
  id: number;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  sectors: string[];
}

interface HumanizedAudit {
  id: number;
  createdAtIso: string;
  actionCanonical: string;
  entityTypeCanonical: string;
  entityIdOriginal: string;
  userId: number | null;
  actorName: string;
  actorUsername: string;
  actionLabel: string;
  entityLabel: string;
  targetId: string;
  sectorName: string;
  summary: string;
  beforeSummary: string;
  afterSummary: string;
  beforeData: unknown;
  afterData: unknown;
  previousComment: string;
  newComment: string;
}

export default function AdminPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [users, setUsers] = useState<UserData[]>([]);
  const [audit, setAudit] = useState<HumanizedAudit[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState(false);

  // Filtros de AuditorÃ­a
  const [auditUser, setAuditUser] = useState('');
  const [auditEntityType, setAuditEntityType] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditTicketId, setAuditTicketId] = useState('');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPages, setAuditPages] = useState(1);
  const [expandedAuditIds, setExpandedAuditIds] = useState<Set<number>>(new Set());

  const toggleAuditDetail = (id: number) => {
    setExpandedAuditIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchAudit = useCallback(async (page = 1) => {
    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '50' });
      if (auditUser) params.set('user', auditUser);
      if (auditEntityType) params.set('entityType', auditEntityType);
      if (auditAction) params.set('action', auditAction);
      if (auditTicketId) params.set('ticketId', auditTicketId);
      if (auditFrom) params.set('from', auditFrom);
      if (auditTo) params.set('to', auditTo);

      const res = await fetch(`/api/admin/audit?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAudit(data.logs || []);
        setAuditTotal(data.total || 0);
        setAuditPages(data.pages || 1);
        setAuditPage(data.page || 1);
      }
    } catch (err) {
      console.error('Error loading audit data:', err);
    }
  }, [auditUser, auditEntityType, auditAction, auditTicketId, auditFrom, auditTo]);

  const fetchAll = useCallback(async () => {
    try {
      const [healthRes, usersRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/admin/users'),
      ]);

      if (healthRes.ok) setHealth(await healthRes.json());
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }
      await fetchAudit(1);
    } catch (err) {
      console.error('Error loading admin data:', err);
    } finally {
      setLoading(false);
    }
  }, [fetchAudit]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage('');
    setSyncError(false);
    try {
      const res = await fetch('/api/sync/run', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        setSyncError(true);
        setSyncMessage(data.error || 'Error de servidor.');
      } else {
        setSyncMessage(data.message || 'SincronizaciÃ³n completada.');
      }
      fetchAll();
    } catch {
      setSyncError(true);
      setSyncMessage('Error de conexiÃ³n al ejecutar sync.');
    } finally {
      setSyncing(false);
    }
  }

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    fetchAudit(1);
  }

  function handleClearFilters() {
    setAuditUser('');
    setAuditEntityType('');
    setAuditAction('');
    setAuditTicketId('');
    setAuditFrom('');
    setAuditTo('');
    setTimeout(() => fetchAudit(1), 0);
  }

  function handleExportExcel() {
    const params = new URLSearchParams();
    if (auditUser) params.set('user', auditUser);
    if (auditEntityType) params.set('entityType', auditEntityType);
    if (auditAction) params.set('action', auditAction);
    if (auditTicketId) params.set('ticketId', auditTicketId);
    if (auditFrom) params.set('from', auditFrom);
    if (auditTo) params.set('to', auditTo);

    window.open(`/api/admin/audit/export?${params.toString()}`, '_blank');
  }

  function formatDate(iso: string): string {
    return formatDateLong(iso);
  }

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner spinner-lg"></div>
        <p>Cargando panel de administraciÃ³n...</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Panel de AdministraciÃ³n</h1>
            <p className="page-subtitle">Estado del sistema, sincronizaciÃ³n y gestiÃ³n de usuarios</p>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Metrics cards */}
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-value">
              {health?.sync.totalCachedTickets ?? 'â€”'}
            </div>
            <div className="metric-label">Tickets en cachÃ©</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">
              {health?.sync.sistemasCachedTickets ?? 'â€”'}
            </div>
            <div className="metric-label">Tickets Sistemas</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{users.length}</div>
            <div className="metric-label">Usuarios activos</div>
          </div>
          <div className="metric-card">
            <div className="metric-value">{auditTotal}</div>
            <div className="metric-label">Eventos de auditorÃ­a</div>
          </div>
        </div>

        {/* GLPI Connection & Sync */}
        <div className="admin-grid" style={{ marginBottom: '24px' }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">ðŸ”Œ ConexiÃ³n GLPI</span>
              <span className="status-indicator">
                <span className={`dot ${health?.glpi.connected ? 'connected' : 'disconnected'}`}></span>
                {health?.glpi.connected ? 'Conectado' : 'Desconectado'}
              </span>
            </div>
            <div className="card-body">
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <p><strong>URL:</strong> {health?.glpi.baseUrl || 'â€”'}</p>
                {health?.glpi.error && (
                  <p style={{ color: 'var(--accent-danger)', marginTop: '8px' }}>
                    Error: {health.glpi.error}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">ðŸ”„ SincronizaciÃ³n</span>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSync}
                disabled={syncing}
              >
                {syncing ? (
                  <>
                    <span className="spinner"></span>
                    Sincronizando...
                  </>
                ) : (
                  'Sincronizar ahora'
                )}
              </button>
            </div>
            <div className="card-body">
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {health?.sync.lastSync ? (
                  <>
                    <p><strong>Ãšltima sync:</strong> {formatDate(health.sync.lastSync.startedAt)}</p>
                    <p><strong>Estado:</strong> {health.sync.lastSync.status}</p>
                    <p><strong>Tickets:</strong> {health.sync.lastSync.ticketsFetched}</p>
                    {health.sync.lastSync.errorMessage && (
                      <p style={{ color: 'var(--accent-danger)', marginTop: '4px' }}>
                        {health.sync.lastSync.errorMessage}
                      </p>
                    )}
                  </>
                ) : (
                  <p>Nunca sincronizado.</p>
                )}
                {syncMessage && (
                  <p style={{ marginTop: '8px', color: syncError ? 'var(--accent-danger)' : 'var(--accent-success)', fontWeight: 500 }}>
                    {syncMessage}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <span className="card-title">ðŸ‘¥ Usuarios</span>
          </div>
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Nombre</th>
                  <th>Perfil</th>
                  <th>Sectores</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="font-mono">{u.username}</span>
                    </td>
                    <td>{u.displayName}</td>
                    <td>
                      <span className="badge badge-encurso">
                        {u.role.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {u.sectors.length > 0 ? u.sectors.join(', ') : 'â€”'}
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'badge-resuelto' : 'badge-cerrado'}`}>
                        {u.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Audit Log */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <span className="card-title">ðŸ“‹ AuditorÃ­a Administrativa Ampliada</span>
            <button className="btn btn-primary btn-sm" onClick={handleExportExcel}>
              ðŸ“¥ Exportar a Excel
            </button>
          </div>

          <form onSubmit={handleFilterSubmit} style={{ padding: '16px', background: 'var(--bg-glass)', borderBottom: '1px solid var(--border)', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Usuario (ID/username)..."
              className="form-input"
              style={{ width: '160px', padding: '6px 10px', fontSize: '0.85rem' }}
              value={auditUser}
              onChange={e => setAuditUser(e.target.value)}
            />
            <select
              className="form-input"
              style={{ width: '150px', padding: '6px 10px', fontSize: '0.85rem' }}
              value={auditEntityType}
              onChange={e => setAuditEntityType(e.target.value)}
            >
              <option value="">Todas entidades</option>
              <option value="ranking">PriorizaciÃ³n</option>
              <option value="coordination">CoordinaciÃ³n</option>
              <option value="user">Usuario</option>
              <option value="sync">SincronizaciÃ³n</option>
              <option value="authentication">AutenticaciÃ³n</option>
            </select>
            <select
              className="form-input"
              style={{ width: '160px', padding: '6px 10px', fontSize: '0.85rem' }}
              value={auditAction}
              onChange={e => setAuditAction(e.target.value)}
            >
              <option value="">Todas acciones</option>
              <option value="ranking_reorder">Reordenar ranking</option>
              <option value="ranking_position_change">Cambio pos. ranking</option>
              <option value="ranking_remove">Quitar ranking</option>
              <option value="ranking_auto_deactivate">Desact. auto ranking</option>
              <option value="ranking_remediation">RemediaciÃ³n ranking</option>
              <option value="coordination_update">Act. coordinaciÃ³n</option>
              <option value="user_create">Crear usuario</option>
              <option value="user_update">Act. usuario</option>
              <option value="user_activate">Activar usuario</option>
              <option value="user_deactivate">Desactivar usuario</option>
              <option value="user_role_change">Cambio rol usuario</option>
              <option value="user_scopes_change">Cambio scopes usuario</option>
              <option value="user_referent_change">Cambio asig. referente</option>
              <option value="manual_sync_success">Sync manual Ã©xito</option>
              <option value="manual_sync_error">Sync manual error</option>
              <option value="login_success">Login Ã©xito</option>
              <option value="login_failure">Login fallo</option>
              <option value="auth_unavailable">Auth no disponible</option>
            </select>
            <input
              type="text"
              placeholder="Ticket ID..."
              className="form-input"
              style={{ width: '110px', padding: '6px 10px', fontSize: '0.85rem' }}
              value={auditTicketId}
              onChange={e => setAuditTicketId(e.target.value)}
            />
            <input
              type="date"
              className="form-input"
              style={{ width: '135px', padding: '6px 10px', fontSize: '0.85rem' }}
              value={auditFrom}
              onChange={e => setAuditFrom(e.target.value)}
              title="Desde"
            />
            <input
              type="date"
              className="form-input"
              style={{ width: '135px', padding: '6px 10px', fontSize: '0.85rem' }}
              value={auditTo}
              onChange={e => setAuditTo(e.target.value)}
              title="Hasta"
            />
            <button type="submit" className="btn btn-secondary btn-sm" style={{ padding: '6px 12px' }}>
              Filtrar
            </button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '6px 12px' }} onClick={handleClearFilters}>
              Limpiar
            </button>
          </form>

          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Actor</th>
                  <th>AcciÃ³n</th>
                  <th>Entidad</th>
                  <th>Sector</th>
                  <th>Resumen</th>
                </tr>
              </thead>
              <tbody>
                {audit.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px' }}>
                      Sin eventos de auditorÃ­a que coincidan con los filtros.
                    </td>
                  </tr>
                ) : (
                  audit.map((a) => (
                    <Fragment key={a.id}>
                      <tr>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {formatDate(a.createdAtIso)}
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{a.actorName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{a.actorUsername}</div>
                        </td>
                        <td>
                          <span className="badge badge-nuevo">{a.actionLabel}</span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{a.entityLabel}</div>
                          <div className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{a.targetId}</div>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>{a.sectorName}</td>
                        <td style={{ fontSize: '0.85rem' }}>
                          <div>{a.summary}</div>
                          {(a.beforeSummary || a.afterSummary) && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {a.beforeSummary && <span>Anterior: {a.beforeSummary} </span>}
                              {a.afterSummary && <span>â†’ Nuevo: {a.afterSummary}</span>}
                            </div>
                          )}
                          <div style={{ marginTop: '6px' }}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '2px 8px', fontSize: '0.75rem', textDecoration: 'underline' }}
                              onClick={() => toggleAuditDetail(a.id)}
                            >
                              {expandedAuditIds.has(a.id) ? 'Ver menos' : 'Ver mÃ¡s'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedAuditIds.has(a.id) && (
                        <tr style={{ background: 'var(--bg-glass)' }}>
                          <td colSpan={6} style={{ padding: '12px', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                              <div>
                                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>Anterior (beforeData):</strong>
                                <pre style={{ margin: 0, padding: '8px', background: 'var(--bg-card)', borderRadius: '4px', overflowX: 'auto', maxHeight: '200px' }}>
                                  {JSON.stringify(a.beforeData ?? null, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>Nuevo (afterData):</strong>
                                <pre style={{ margin: 0, padding: '8px', background: 'var(--bg-card)', borderRadius: '4px', overflowX: 'auto', maxHeight: '200px' }}>
                                  {JSON.stringify(a.afterData ?? null, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {auditPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Mostrando pÃ¡gina {auditPage} de {auditPages} ({auditTotal} registros en total)
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={auditPage <= 1}
                  onClick={() => fetchAudit(auditPage - 1)}
                >
                  Anterior
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={auditPage >= auditPages}
                  onClick={() => fetchAudit(auditPage + 1)}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
