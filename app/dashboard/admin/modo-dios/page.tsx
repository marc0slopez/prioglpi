'use client';

import { useState, useEffect } from 'react';
import PriorizadorView from '@/app/components/PriorizadorView';

export default function ModoDiosPage() {
  const [priorizadores, setPriorizadores] = useState<{ id: number; name: string; username: string }[]>([]);
  const [selectedPriorizador, setSelectedPriorizador] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin/users/priorizadores');
        if (res.ok) {
          const data = await res.json();
          setPriorizadores(data);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: '16px', padding: '16px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>Modo Dios - Selección de Priorizador</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label style={{ fontWeight: 'bold' }}>Priorizador:</label>
          <select
            className="form-input"
            style={{ width: '300px' }}
            value={selectedPriorizador || ''}
            onChange={(e) => setSelectedPriorizador(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Seleccione un priorizador...</option>
            {priorizadores.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.username})</option>
            ))}
          </select>
          {loading && <span className="spinner"></span>}
        </div>
      </div>

      {selectedPriorizador ? (
        <PriorizadorView key={selectedPriorizador} ownerUserId={selectedPriorizador} />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: '8px', minHeight: '300px' }}>
          <p>Seleccione un priorizador de la lista para ver y operar sobre su bandeja.</p>
        </div>
      )}
    </div>
  );
}
