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
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="field">
      {label && <span>{label}</span>}
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
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
