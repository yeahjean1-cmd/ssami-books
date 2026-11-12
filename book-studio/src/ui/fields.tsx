import { useEffect, useState } from 'react';

interface NumProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  id?: string;
}

/** 숫자 입력. 입력 중인 값은 그대로 두고, 올바른 숫자일 때만 문서에 반영한다. */
export function NumField({ label, value, onChange, min = -Infinity, max = Infinity, step = 1, unit, id }: NumProps) {
  const shown = String(Math.round(value * 100) / 100);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-input">
        <input
          id={id}
          type="number"
          value={text}
          step={step}
          min={Number.isFinite(min) ? min : undefined}
          max={Number.isFinite(max) ? max : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
          onBlur={() => setText(shown)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {unit && <em>{unit}</em>}
      </div>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="field">
      {label && <span>{label}</span>}
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} title={o.title} aria-label={o.title} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ICONS: Record<string, string> = {
  text: 'M3 4h10M8 4v9M6 13h4',
  image: 'M2.5 3.5h11v9h-11zM2.5 10.5l3.5-3 3 2.5 2-1.5 2.5 2',
  shape: 'M2.5 7.5h6v6h-6zM13.5 6a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z',
  undo: 'M5.5 3.5l-3 3 3 3M2.5 6.5H9a4 4 0 0 1 0 8H7',
  redo: 'M10.5 3.5l3 3-3 3M13.5 6.5H7a4 4 0 0 0 0 8h2',
  left: 'M2.5 4h11M2.5 8h7M2.5 12h9',
  center: 'M2.5 4h11M4.5 8h7M3.5 12h9',
  right: 'M2.5 4h11M6.5 8h7M4.5 12h9',
  justify: 'M2.5 4h11M2.5 8h11M2.5 12h11',
};

/** 선으로 그린 16px 아이콘. 글자색을 따른다. */
export function Icon({ name }: { name: keyof typeof ICONS | string }) {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function readFile(file: File, as: 'dataUrl' | 'text' | 'buffer'): Promise<any> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
    if (as === 'dataUrl') r.readAsDataURL(file);
    else if (as === 'text') r.readAsText(file);
    else r.readAsArrayBuffer(file);
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
