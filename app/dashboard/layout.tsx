'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { formatDateLong } from '@/lib/formatDate';

function recordActivity(event: { kind: 'page'; path: string } | { kind: 'ticket'; ticketId: number }) {
  void fetch('/api/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}

interface UserData {
  userId: number;
  username: string;
  displayName: string;
  role: string;
  sectors: string[];
}

interface SyncStatus {
  lastSync: {
    finishedAt: string | null;
    status: string;
  } | null;
  totalCachedTickets: number;
  sistemasCachedTickets: number;
}

const NAV_ITEMS: Record<string, { label: string; icon: string; path: string }[]> = {
  admin: [
    { label: 'Panel Admin', icon: 'âš™ï¸', path: '/dashboard/admin' },
    { label: 'Modo Dios', icon: 'ðŸ§¿', path: '/dashboard/admin/modo-dios' },
  ],
  coordinador_sistemas: [
    { label: 'MÃ©tricas', icon: 'ðŸ“Š', path: '/dashboard/coordinador/metricas' },
    { label: 'Bandeja Priorizada', icon: 'ðŸ“‹', path: '/dashboard/coordinador' },
  ],
  tecnico_sistemas: [
    { label: 'MÃ©tricas', icon: 'ðŸ“Š', path: '/dashboard/coordinador/metricas' },
    { label: 'Bandeja Priorizada', icon: 'ðŸ“‹', path: '/dashboard/coordinador' },
  ],
  priorizador: [
    { label: 'MÃ©tricas', icon: 'ðŸ“Š', path: '/dashboard/priorizador/metricas' },
    { label: 'Bandeja Priorizada', icon: 'ðŸ†', path: '/dashboard/priorizador' },
  ],
  referente: [
    { label: 'MÃ©tricas', icon: 'ðŸ“Š', path: '/dashboard/referente/metricas' },
    { label: 'Tickets', icon: 'ðŸ“‹', path: '/dashboard/referente' },
  ],
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  coordinador_sistemas: 'Coordinador Sistemas',
  tecnico_sistemas: 'TÃ©cnico Sistemas',
  priorizador: 'Priorizador',
  referente: 'Referente',
};

function getInitials(displayName: string, username: string): string {
  if (username && username.includes('_')) {
    return username.split('_').map(p => p.charAt(0)).join('').toUpperCase().substring(0, 2);
  }
  if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    const uppers = displayName.match(/[A-Z]/g);
    if (uppers && uppers.length >= 2) {
      return uppers.slice(0, 2).join('');
    }
    return displayName.substring(0, 2).toUpperCase();
  }
  return '??';
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserData | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const savedWidth = localStorage.getItem('prioglpi.sidebarWidth.v1');
    if (savedWidth) {
      const parsed = parseInt(savedWidth, 10);
      if (!isNaN(parsed)) {
        const clamped = Math.max(180, Math.min(420, parsed));
        setSidebarWidth(clamped);
        document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`);
      }
    } else {
      document.documentElement.style.setProperty('--sidebar-width', '220px');
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;
    let newWidth = e.clientX;
    const usesCompactSidebar = ['admin', 'priorizador', 'referente', 'coordinador_sistemas', 'tecnico_sistemas'].includes(user?.role || '');
    const minW = usesCompactSidebar ? 72 : 180;
    const maxW = usesCompactSidebar ? 240 : 420;
    newWidth = Math.max(minW, Math.min(maxW, newWidth));
    setSidebarWidth(newWidth);
    document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;
    setIsResizing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.userSelect = '';
    localStorage.setItem('prioglpi.sidebarWidth.v1', sidebarWidth.toString());
  };

  const handleDoubleClick = () => {
    setSidebarWidth(220);
    document.documentElement.style.setProperty('--sidebar-width', '220px');
    localStorage.setItem('prioglpi.sidebarWidth.v1', '220');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const usesCompactSidebar = ['admin', 'priorizador', 'referente', 'coordinador_sistemas', 'tecnico_sistemas'].includes(user?.role || '');
    const minW = usesCompactSidebar ? 72 : 180;
    const maxW = usesCompactSidebar ? 240 : 420;

    if (e.key === 'ArrowLeft') {
      const w = Math.max(minW, sidebarWidth - 10);
      setSidebarWidth(w);
      document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
      localStorage.setItem('prioglpi.sidebarWidth.v1', w.toString());
    } else if (e.key === 'ArrowRight') {
      const w = Math.min(maxW, sidebarWidth + 10);
      setSidebarWidth(w);
      document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
      localStorage.setItem('prioglpi.sidebarWidth.v1', w.toString());
    }
  };

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => {
        if (!res.ok) throw new Error('No auth');
        return res.json();
      })
      .then((data) => {
        setUser(data);
        if (['priorizador', 'referente', 'coordinador_sistemas', 'tecnico_sistemas'].includes(data.role)) {
          const savedWidth = localStorage.getItem('prioglpi.sidebarWidth.v1');
          if (!savedWidth) {
            setSidebarWidth(80);
            document.documentElement.style.setProperty('--sidebar-width', '80px');
          }
        }
      })
      .catch(() => router.replace('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  const fetchSyncStatus = useCallback(() => {
    fetch('/api/sync/status')
      .then((res) => res.ok ? res.json() : null)
      .then(setSyncStatus)
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (user) {
      fetchSyncStatus();
      const interval = setInterval(fetchSyncStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [user, fetchSyncStatus]);

  // Close sidebar on route change in mobile
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (user && pathname) recordActivity({ kind: 'page', path: pathname });
  }, [user, pathname]);

  useEffect(() => {
    if (!user) return;
    const handleTicketLink = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>('a[data-audit-ticket-id]');
      const id = link?.dataset.auditTicketId;
      if (!id || !/^[1-9]\d*$/.test(id)) return;
      const ticketId = Number(id);
      if (Number.isSafeInteger(ticketId)) recordActivity({ kind: 'ticket', ticketId });
    };
    document.addEventListener('click', handleTicketLink, true);
    return () => document.removeEventListener('click', handleTicketLink, true);
  }, [user]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  if (loading) {
    return (
      <div className="loading-state" style={{ minHeight: '100vh' }}>
        <div className="spinner spinner-lg"></div>
        <p>Cargando...</p>
      </div>
    );
  }

  if (!user) return null;

  const navItems = [...(NAV_ITEMS[user.role] || [])];

  function formatSyncTime(iso: string | null | undefined): string {
    if (!iso) return 'Nunca';
    const d = new Date(iso);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return 'Hace unos segundos';
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
    return formatDateLong(iso);
  }

  const usesCompactSidebar = ['admin', 'priorizador', 'referente', 'coordinador_sistemas', 'tecnico_sistemas'].includes(user.role);
  const isCollapsed = usesCompactSidebar && sidebarWidth < 150;
  const compactSidebarClass = usesCompactSidebar
    ? (isCollapsed ? 'compact-sidebar-collapsed' : 'compact-sidebar-expanded')
    : '';

  return (
    <div className={`app-layout ${compactSidebarClass}`}>
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''} ${compactSidebarClass}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand" style={{ display: 'flex', flexDirection: isCollapsed ? 'column' : 'row', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: isCollapsed ? '6px' : '10px', width: '100%' }}>
            {isCollapsed && <span className="brand-text-collapsed" style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Prio</span>}
            <Image src="/branding/logo.png" alt="GLPI Logo" width={28} height={28} style={{ objectFit: 'contain' }} />
            {!isCollapsed && <span className="brand-text">PrioGLPI</span>}
          </div>
          {!isCollapsed && <div className="sidebar-subtitle brand-subtitle">PriorizaciÃ³n de Tickets</div>}
        </div>

        <nav className="sidebar-nav">
          {!isCollapsed && <div className="nav-section-title">NavegaciÃ³n</div>}
          {navItems.map((item) => (
            <div
              key={item.path}
              className={`nav-item ${pathname === item.path ? 'active' : ''}`}
              onClick={() => router.push(item.path)}
              title={isCollapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              {!isCollapsed && <span className="nav-label">{item.label}</span>}
            </div>
          ))}
        </nav>

        {/* Sync status */}
        <div style={{ padding: '12px 16px' }}>
          <div className="sync-indicator" title={isCollapsed ? `Sync: ${formatSyncTime(syncStatus?.lastSync?.finishedAt)}${syncStatus ? ` - ${syncStatus.sistemasCachedTickets} tickets Sistemas` : ''}` : undefined}>
            <span
              className={`sync-dot ${syncStatus?.lastSync?.status === 'success'
                  ? ''
                  : syncStatus?.lastSync?.status === 'running'
                    ? 'syncing'
                    : 'error'
                }`}
            ></span>
            {!isCollapsed && (
              <span className="sync-label">
                Sync: {formatSyncTime(syncStatus?.lastSync?.finishedAt)}
              </span>
            )}
          </div>
          {!isCollapsed && syncStatus && (
            <div className="sync-detail" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '6px', paddingLeft: '4px' }}>
              {syncStatus.sistemasCachedTickets} tickets Sistemas
            </div>
          )}
        </div>

        {/* User info & logout */}
        <div className="sidebar-footer">
          {isCollapsed ? (
            <div className="sidebar-user-compact" title={`${user.displayName} - ${ROLE_LABELS[user.role] || user.role}`} style={{ display: 'flex', justifyContent: 'center', padding: '8px 0', width: '100%', background: 'transparent', border: 'none', boxShadow: 'none', margin: '0' }}>
              <div className="sidebar-user-avatar" style={{ margin: '0 auto', width: '42px', height: '42px', minWidth: '42px', fontSize: '1rem' }}>
                {getInitials(user.displayName, user.username)}
              </div>
            </div>
          ) : (
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">
                {getInitials(user.displayName, user.username)}
              </div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name user-name">{user.displayName}</div>
                <div className="sidebar-user-role user-role">{ROLE_LABELS[user.role] || user.role}</div>
              </div>
            </div>
          )}
          <button
            className={`btn btn-secondary btn-sm btn-block logout-btn logout-button ${isCollapsed ? 'collapsed-btn' : ''}`}
            style={{ marginTop: '8px' }}
            onClick={handleLogout}
            title={isCollapsed ? "Cerrar sesiÃ³n" : undefined}
          >
            {isCollapsed ? (
              <span className="logout-icon" style={{ fontSize: '1.2rem', lineHeight: 1 }}>â†ª</span>
            ) : (
              <span className="logout-text logout-label">Cerrar sesiÃ³n</span>
            )}
          </button>
        </div>

        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={usesCompactSidebar ? 72 : 220}
          aria-valuemax={usesCompactSidebar ? 240 : 420}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
        />
      </aside>

      {/* Main content */}
      <main className="main-content">
        <div className="mobile-header">
          <button
            className="menu-toggle"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Abrir menÃº"
          >
            â˜°
          </button>
          <div className="mobile-brand" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
            <Image src="/branding/logo.png" alt="GLPI Logo" width={20} height={20} />
            PrioGLPI
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
