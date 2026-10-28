'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    const formData = new FormData(e.currentTarget);
    const username = String(formData.get('username') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    if (!username || !password) {
      setError('Por favor, completá ambos campos.');
      return;
    }

    setLoading(true);

    try {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Error al iniciar sesión.');
        setLoading(false);
        return;
      }
      const authUser = data.user ?? data;
      if (!authUser?.role) {
        setError('Login correcto, pero el usuario no tiene rol válido.');
        setLoading(false);
        return;
      }

      const target =
        authUser.role === 'admin'
          ? '/dashboard/admin'
          : authUser.role === 'coordinador_sistemas' || authUser.role === 'tecnico_sistemas'
            ? '/dashboard/coordinador/metricas'
            : authUser.role === 'priorizador'
              ? '/dashboard/priorizador/metricas'
              : authUser.role === 'referente'
                ? '/dashboard/referente/metricas'
                : '/dashboard/admin';

      console.log('Navegando a target:', target);
      window.location.assign(target);
      return;
    } catch {
      setError('Error de conexión con el servidor.');
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo login-logo-vertical">
          <h2 className="login-logo-brand">PrioGLPI</h2>
          <Image
            src="/branding/logo.png"
            alt="GLPI Logo"
            width={220}
            height={80}
            className="login-logo-img"
            priority
          />
          <p className="login-logo-subtitle">Sistema de Priorización de Tickets</p>
        </div>

        <form className="login-form" method="post" onSubmit={handleSubmit} autoComplete="off">
          {error && <div className="login-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">Usuario</label>
            <input
              id="username"
              name="username"
              type="text"
              className="form-input"
              placeholder="Ingresá tu usuario"
              autoComplete="off"
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              className="form-input"
              placeholder="Ingresá tu contraseña"
              autoComplete="new-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg btn-block"
            disabled={loading || !hydrated}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Ingresando...
              </>
            ) : (
              'Ingresar'
            )}
          </button>
        </form>

        <div style={{ marginTop: '24px', textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Aplicación interna — Sistemas
          </p>
        </div>
      </div>
    </div>
  );
}
