import React, { useState } from 'react';

export default function CoordinatorComment({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return null;

  const isLong = text.length > 80;

  return (
    <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', width: '100%' }}>
      <strong>Comentario de Coordinación:</strong>
      <div style={{
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        minWidth: 0,
        maxWidth: '100%',
        marginTop: '0.25rem',
        color: 'var(--text-secondary)'
      }}>
        {expanded || !isLong ? text : `${text.slice(0, 80)}...`}
        {isLong && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--primary-color)',
              cursor: 'pointer',
              padding: 0,
              font: 'inherit',
              marginLeft: '4px',
              textDecoration: 'underline'
            }}
          >
            {expanded ? 'Ver menos' : 'Ver más'}
          </button>
        )}
      </div>
    </div>
  );
}
