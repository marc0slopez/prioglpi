'use client';

import { useRef, useState } from 'react';
import { formatDate, formatDateLong } from '@/lib/formatDate';
import { ttrCalendarStatus } from '@/lib/ttr-calendar';

export interface TicketGlpiSummaryData {
  progressPercent: number | null;
  timeToResolve: string | null;
  liveDataAvailable: boolean;
  latestFollowup: {
    author: string | null;
    content: string;
    createdAt: string;
  } | null;
}

type LatestFollowup = NonNullable<TicketGlpiSummaryData['latestFollowup']>;

export function TicketGlpiFacts({ summary, status }: { summary?: TicketGlpiSummaryData; status?: number }) {
  if (!summary) return null;

  const progress = !summary.liveDataAvailable ? 'No disponible'
    : summary.progressPercent === null ? 'Sin dato' : `${summary.progressPercent}%`;
  const ttr = !summary.liveDataAvailable ? 'No disponible'
    : summary.timeToResolve ? formatDate(summary.timeToResolve) || 'Sin fecha' : 'Sin fecha';
  const ttrStatus = status !== undefined && status < 5 && summary.liveDataAvailable
    ? ttrCalendarStatus(summary.timeToResolve) : null;

  return (
    <div className="ticket-glpi-summary ticket-glpi-facts">
      <span><strong>Progreso del ticket</strong> {progress}</span>
      <span title={summary.timeToResolve ? formatDateLong(summary.timeToResolve) : undefined}>
        <strong>Fecha TTR (tiempo para resolverlo)</strong> {ttr}
      </span>
      {ttrStatus && <span className={`ticket-ttr-status ticket-ttr-${ttrStatus.tone}`}>{ttrStatus.label}</span>}
    </div>
  );
}

export function TicketGlpiFollowup({ summary, ticketId, canAdd = false }: {
  summary?: TicketGlpiSummaryData;
  ticketId: number;
  canAdd?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [newFollowup, setNewFollowup] = useState<LatestFollowup | null>(null);

  if (!summary) return null;

  const latest = newFollowup || summary.latestFollowup;
  const comment = latest?.content || '';
  const isLong = comment.length > 160;
  const displayedComment = expanded || !isLong ? comment : `${comment.slice(0, 160).trimEnd()}...`;

  async function addFollowup() {
    const content = draft.trim();
    if (!content || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/tickets/${ticketId}/followups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'No se pudo agregar el comentario en GLPI.');
        return;
      }
      setNewFollowup(data.followup);
      setExpanded(false);
      setEditing(false);
      setDraft('');
    } catch {
      setError('No se pudo conectar con GLPI. Revisá el ticket antes de reintentar.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="ticket-glpi-summary ticket-glpi-followup">
      <div className="ticket-glpi-followup-header">
        <div>
          <strong>Último comentario</strong>
          {latest?.author && <span className="ticket-glpi-author"> · {latest.author}</span>}
        </div>
        {canAdd && !editing && (
          <button type="button" className="btn btn-secondary btn-sm ticket-glpi-add-button"
            title="Agregar comentario visible en GLPI" aria-label={`Agregar comentario al ticket ${ticketId}`}
            onClick={() => setEditing(true)}><span aria-hidden="true">✎</span> Agregar comentario al ticket</button>
        )}
      </div>
      <div className="ticket-glpi-comment">
        {comment ? displayedComment : 'Sin comentarios'}
        {isLong && (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Ver menos' : 'Ver más'}
          </button>
        )}
      </div>
      {editing && (
        <div className="ticket-glpi-editor" onDragStart={(event) => event.stopPropagation()}>
          <label htmlFor={`glpi-followup-${ticketId}`}>Nuevo comentario visible en GLPI</label>
          <textarea id={`glpi-followup-${ticketId}`} className="form-input" rows={3}
            maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)}
            placeholder="Escribí el comentario" disabled={saving} />
          <div className="ticket-glpi-editor-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving}
              onClick={() => { setEditing(false); setDraft(''); setError(''); }}>Cancelar</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving || !draft.trim()}
              onClick={addFollowup}>{saving ? 'Guardando...' : 'Agregar'}</button>
          </div>
        </div>
      )}
      {error && <p className="ticket-glpi-error" role="alert">{error}</p>}
    </div>
  );
}

export default function TicketGlpiSummary({ summary, ticketId, status, canAdd = false }: {
  summary?: TicketGlpiSummaryData;
  ticketId: number;
  status?: number;
  canAdd?: boolean;
}) {
  if (!summary) return null;
  return (
    <div className="ticket-glpi-overview">
      <TicketGlpiFacts summary={summary} status={status} />
      <TicketGlpiFollowup summary={summary} ticketId={ticketId} canAdd={canAdd} />
    </div>
  );
}
