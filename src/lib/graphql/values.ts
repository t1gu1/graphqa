import type { FieldSpec } from './fields';

export type Values = Record<string, unknown>;

export function splitPath(path: string): string[] {
  return path.split('.').filter(Boolean);
}

export function getAt(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Écriture immuable à un chemin (les index numériques créent des tableaux). */
export function setAt<T>(obj: T, path: string[], value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const isIndex = /^\d+$/.test(head);
  const container: Record<string, unknown> | unknown[] = Array.isArray(obj)
    ? [...obj]
    : obj && typeof obj === 'object'
      ? { ...(obj as Record<string, unknown>) }
      : isIndex
        ? []
        : {};
  const current = (container as Record<string, unknown>)[head];
  const next = setAt(current, rest, value);
  if (next === undefined && !Array.isArray(container)) delete (container as Record<string, unknown>)[head];
  else (container as Record<string, unknown>)[head] = next;
  return container as T;
}

export function removeAt<T>(obj: T, path: string[]): T {
  return setAt(obj, path, undefined);
}

const SAMPLE_TEXT: [RegExp, string][] = [
  [/e-?mail|courriel/, 'marie.tremblay@exemple.com'],
  [/password|motdepasse|mot_de_passe|secret/, 'MotDePasse123!'],
  [/first.?name|prenom|prénom|given/, 'Marie'],
  [/last.?name|family|nom.?de.?famille|surname/, 'Tremblay'],
  [/full.?name|display.?name|^name$|^nom$|author|customer/, 'Marie Tremblay'],
  [/user.?name|login|handle|pseudo/, 'marie.t'],
  [/phone|tel/, '+1 514 555 0123'],
  [/url|website|link|site/, 'https://exemple.com'],
  [/slug/, 'exemple-de-slug'],
  [/city|ville/, 'Montréal'],
  [/country|pays/, 'Canada'],
  [/postal|zip/, 'H2X 1Y4'],
  [/address|adresse|street|rue/, '123, rue Exemple'],
  [/color|colour|couleur/, '#5B5BD6'],
  [/title|titre|subject|sujet|label/, "Titre d'exemple"],
  [/description|note|comment|message|body|content|bio|text/, "Texte d'exemple pour le test."],
  [/code|sku|reference|ref/, 'ABC-123'],
  [/token|key|cle|clé/, 'cle-exemple-123'],
  [/lang|locale/, 'fr'],
  [/currency|devise/, 'CAD'],
];

function sampleText(name: string): string {
  const n = name.toLowerCase();
  for (const [re, v] of SAMPLE_TEXT) if (re.test(n)) return v;
  return 'Exemple';
}

function fitLength(text: string, min?: number, max?: number): string {
  let t = text;
  if (min !== undefined && t.length < min) t = t + 'x'.repeat(min - t.length);
  if (max !== undefined && t.length > max) t = t.slice(0, Math.max(max, 0));
  return t;
}

function clamp(n: number, min?: number, max?: number): number {
  let v = n;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

function sampleInt(name: string): number {
  const n = name.toLowerCase();
  if (/^(take|limit|first|last|pagesize|page_size|perpage|per_page|size|count)$/.test(n)) return 10;
  if (/^(skip|offset)$/.test(n)) return 0;
  if (/page/.test(n)) return 1;
  if (/age/.test(n)) return 30;
  if (/year|annee|année/.test(n)) return new Date().getFullYear();
  if (/quantity|qty|quantite|quantité/.test(n)) return 1;
  return 1;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Valeur d'exemple plausible, qui respecte les règles connues du champ. */
export function exampleValue(spec: FieldSpec): unknown {
  const c = spec.constraints;
  if (spec.defaultValue !== undefined && spec.defaultValue !== null) return spec.defaultValue;
  switch (spec.kind) {
    case 'string':
    case 'custom': {
      if (c.allowed?.length) return c.allowed[0];
      if (c.format === 'email') return 'marie.tremblay@exemple.com';
      if (c.format === 'url') return 'https://exemple.com';
      if (c.format === 'uuid') return '3f2b8c1e-6d4a-4f0b-9c7e-2a1d5e8f9b10';
      return fitLength(sampleText(spec.name), c.minLength, c.maxLength);
    }
    case 'id':
      return '1';
    case 'int':
      return clamp(sampleInt(spec.name), c.min, c.max);
    case 'float':
      return clamp(/price|amount|total|prix|montant|cost/.test(spec.name.toLowerCase()) ? 19.99 : 1.5, c.min, c.max);
    case 'boolean':
      return false;
    case 'enum':
      return spec.enumValues?.[0]?.value;
    case 'date':
      return todayIso();
    case 'datetime':
      return new Date().toISOString();
    case 'time':
      return '12:00:00';
    case 'json':
      return {};
    case 'upload':
      return undefined;
    case 'object':
      return exampleVariables(spec.children ?? []);
    case 'list': {
      const item = spec.item ? exampleValue(spec.item) : undefined;
      return item === undefined ? [] : [item];
    }
  }
}

export function exampleVariables(fields: FieldSpec[]): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = exampleValue(f);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

/** Valeurs de départ : les valeurs par défaut du schéma, rien d'autre. */
export function initialVariables(fields: FieldSpec[]): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.defaultValue !== undefined && f.defaultValue !== null) out[f.name] = f.defaultValue;
    else if (f.kind === 'object' && f.required) out[f.name] = initialVariables(f.children ?? []);
  }
  return out;
}

/**
 * Nettoie les valeurs avant l'envoi : un champ facultatif laissé vide n'est pas
 * envoyé. Un champ obligatoire vide est envoyé tel quel (c'est souvent un cas à tester).
 */
export function prepareVariables(fields: FieldSpec[], values: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = prepareValue(f, values[f.name]);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

function prepareValue(f: FieldSpec, v: unknown): unknown {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (f.kind === 'object') {
    if (typeof v !== 'object' || Array.isArray(v)) return v;
    const inner = prepareVariables(f.children ?? [], v as Values);
    if (!f.required && Object.keys(inner).length === 0) return undefined;
    return inner;
  }
  if (f.kind === 'list') {
    if (!Array.isArray(v)) return v;
    const item = f.item;
    const items = item ? v.map((x) => prepareValue({ ...item, required: true }, x)).filter((x) => x !== undefined) : v;
    if (!f.required && items.length === 0) return undefined;
    return items;
  }
  if (typeof v === 'string' && v === '' && !f.required) return undefined;
  return v;
}

/** Un champ obligatoire sans valeur, pour avertir avant l'exécution. */
export function missingRequired(fields: FieldSpec[], values: Values, prefix = ''): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const v = values?.[f.name];
    const label = prefix ? `${prefix} › ${f.label}` : f.label;
    if (f.kind === 'object') {
      if (f.required && (v == null || typeof v !== 'object')) out.push(label);
      else if (v && typeof v === 'object') out.push(...missingRequired(f.children ?? [], v as Values, label));
    } else if (f.required && (v === undefined || v === null)) {
      out.push(label);
    }
  }
  return out;
}
