import { useEffect, useState } from 'react';
import type { FieldSpec } from '../lib/graphql/fields';
import { exampleValue } from '../lib/graphql/values';
import { Icon } from './Icon';

export type ErrorLookup = (spec: FieldSpec) => string | undefined;

interface Props {
  spec: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  errorFor: ErrorLookup;
  /** Pour un élément de liste : pas d'étiquette propre. */
  bare?: boolean;
  idSuffix?: string;
}

function toLocalInput(iso: unknown): string | null {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function JsonInput({ id, value, onChange, invalid }: { id: string; value: unknown; onChange: (v: unknown) => void; invalid: boolean }) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value === undefined ? '' : JSON.stringify(value, null, 2));
  }, [value]);
  return (
    <>
      <textarea
        id={id}
        className={`fld mono${invalid || bad ? ' invalid' : ''}`}
        rows={4}
        value={text}
        placeholder="{ }"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) {
            setBad(false);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(text));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && <span className="field-error">Ce n’est pas du JSON valide.</span>}
    </>
  );
}

function Control({ spec, value, onChange, id, invalid }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void; id: string; invalid: boolean }) {
  const cls = `fld${invalid ? ' invalid' : ''}`;
  switch (spec.kind) {
    case 'enum':
      return (
        <select id={id} className={cls} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{spec.required ? '— Choisir —' : '— Non renseigné —'}</option>
          {spec.enumValues?.map((v) => (
            <option key={v.value} value={v.value} title={v.description ?? undefined}>
              {v.value}
            </option>
          ))}
          {typeof value === 'string' && value && !spec.enumValues?.some((v) => v.value === value) && <option value={value}>{value} (hors liste)</option>}
        </select>
      );
    case 'boolean': {
      const opts: [string, boolean | undefined][] = [
        ['Oui', true],
        ['Non', false],
      ];
      if (!spec.required) opts.push(['Non renseigné', undefined]);
      return (
        <div className="tri" role="group" aria-labelledby={`${id}-label`}>
          {opts.map(([label, v]) => (
            <button key={label} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
              {label}
            </button>
          ))}
        </div>
      );
    }
    case 'int':
    case 'float':
      return (
        <input
          id={id}
          className={`${cls} mono`}
          type="number"
          step={spec.kind === 'int' ? 1 : 'any'}
          min={spec.constraints.min}
          max={spec.constraints.max}
          value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <input id={id} className={cls} type={typeof value === 'string' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value) ? 'text' : 'date'} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} />
      );
    case 'datetime': {
      const local = toLocalInput(value);
      if (local === null)
        return <input id={id} className={`${cls} mono`} type="text" value={String(value)} onChange={(e) => onChange(e.target.value || undefined)} />;
      return (
        <input
          id={id}
          className={cls}
          type="datetime-local"
          value={local}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : undefined)}
        />
      );
    }
    case 'json':
      return <JsonInput id={id} value={value} onChange={onChange} invalid={invalid} />;
    case 'upload':
      return <div className="notice">Les envois de fichiers ne sont pas encore pris en charge.</div>;
    default:
      return (
        <input
          id={id}
          className={cls}
          type="text"
          spellCheck={false}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          placeholder={spec.required ? '' : 'Facultatif'}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Un champ du formulaire généré depuis le schéma (récursif pour les groupes et les listes). */
export function FieldInput({ spec, value, onChange, errorFor, bare, idSuffix = '' }: Props) {
  const id = `f-${spec.path}${idSuffix}`;

  if (spec.kind === 'object') {
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return (
      <fieldset className="field-group">
        <legend>
          {spec.label}
          {spec.required && <span style={{ color: 'var(--err)' }}> *</span>}
          <span className="mono muted" style={{ fontWeight: 400, fontSize: 11.5, marginLeft: 8 }}>
            {spec.typeLabel}
          </span>
        </legend>
        {spec.description && <p className="field-hint">{spec.description}</p>}
        <div className="form-grid">
          {(spec.children ?? []).map((c) => (
            <FieldInput
              key={c.path}
              spec={c}
              value={obj[c.name]}
              errorFor={errorFor}
              idSuffix={idSuffix}
              onChange={(v) => {
                const next = { ...obj };
                if (v === undefined) delete next[c.name];
                else next[c.name] = v;
                onChange(Object.keys(next).length || spec.required ? next : undefined);
              }}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  if (spec.kind === 'list' && spec.item) {
    const items = Array.isArray(value) ? value : [];
    const item = spec.item;
    const setItem = (i: number, v: unknown) => onChange(items.map((x, n) => (n === i ? v : x)));
    const content = (
      <div className="list-items">
        {items.map((v, i) => (
          <div key={i} className="list-item">
            <FieldInput spec={{ ...item, required: true }} value={v} bare errorFor={errorFor} idSuffix={`${idSuffix}-${i}`} onChange={(nv) => setItem(i, nv)} />
            <button type="button" className="btn btn-plain btn-icon" aria-label={`Retirer l'élément ${i + 1}`} onClick={() => onChange(items.filter((_, n) => n !== i))}>
              <Icon name="x" />
            </button>
          </div>
        ))}
        <button type="button" className="btn-link" style={{ alignSelf: 'flex-start', fontSize: 13.5 }} onClick={() => onChange([...items, exampleValue(item) ?? ''])}>
          + Ajouter un élément
        </button>
      </div>
    );
    if (item.kind === 'object') {
      return (
        <fieldset className="field-group">
          <legend>
            {spec.label}
            {spec.required && <span style={{ color: 'var(--err)' }}> *</span>}
            <span className="mono muted" style={{ fontWeight: 400, fontSize: 11.5, marginLeft: 8 }}>
              {spec.typeLabel}
            </span>
          </legend>
          {content}
        </fieldset>
      );
    }
    return (
      <div className="field">
        <span className="field-label" id={`${id}-label`}>
          {spec.label}
          {spec.required && <span className="req">*</span>}
          <span className="gql">{spec.typeLabel}</span>
        </span>
        {content}
        <span className="field-hint">{spec.rules.join(' · ')}</span>
      </div>
    );
  }

  const error = errorFor(spec);
  const control = <Control spec={spec} value={value} onChange={onChange} id={id} invalid={!!error} />;
  if (bare) return <div className="stack" style={{ gap: 4 }}>{control}{error && <span className="field-error">{error}</span>}</div>;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id} id={`${id}-label`}>
        <span className={spec.deprecated ? 'deprecated' : undefined}>{spec.label}</span>
        {spec.required && (
          <span className="req" aria-label="obligatoire">
            *
          </span>
        )}
        <span className="gql" title={spec.name}>
          {spec.typeLabel}
        </span>
      </label>
      {control}
      {error ? (
        <span className="field-error">
          <Icon name="info" size={15} strokeWidth={2.2} style={{ flex: 'none', marginTop: 1 }} />
          {error}
        </span>
      ) : (
        <span className="field-hint" title={spec.description ?? undefined}>
          {spec.description ? `${spec.description} · ` : ''}
          {spec.rules.join(' · ')}
        </span>
      )}
    </div>
  );
}
