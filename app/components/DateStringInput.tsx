'use client';

import { useState, useEffect } from 'react';

export default function DateStringInput({ value, onChange }: { value: string, onChange: (v: string) => void }) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (value) {
      const parts = value.split('-');
      if (parts.length === 3) {
        setText(`${parts[2]}/${parts[1]}/${parts[0]}`);
      } else {
        setText('');
      }
    } else {
      setText('');
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^\d/]/g, '');

    // Auto-insert slashes
    if (val.length === 2 && text.length < 2) val += '/';
    if (val.length === 5 && text.length < 5) val += '/';

    setText(val);

    if (val.length === 10) {
      const parts = val.split('/');
      if (parts.length === 3) {
        onChange(`${parts[2]}-${parts[1]}-${parts[0]}`);
      }
    } else {
      onChange('');
    }
  };

  return (
    <input
      type="text"
      className="form-input"
      style={{ background: 'transparent', border: 'none', padding: 0, height: 'auto', width: '85px', textAlign: 'center' }}
      placeholder="DD/MM/AAAA"
      maxLength={10}
      value={text}
      onChange={handleChange}
    />
  );
}
