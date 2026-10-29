import {
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isScalarType,
  type GraphQLArgument,
  type GraphQLInputField,
  type GraphQLInputType,
} from 'graphql';
import type { LearnedRule } from '../types';

export type FieldKind =
  | 'string'
  | 'int'
  | 'float'
  | 'boolean'
  | 'id'
  | 'enum'
  | 'date'
  | 'datetime'
  | 'time'
  | 'json'
  | 'object'
  | 'list'
  | 'upload'
  | 'custom';

export interface Constraints {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  format?: 'email' | 'url' | 'uuid' | 'phone';
  allowed?: string[];
}

export interface FieldSpec {
  /** Chemin dans les variables : "input.email", "take"… */
  path: string;
  name: string;
  label: string;
  description: string | null;
  kind: FieldKind;
  required: boolean;
  typeLabel: string;
  scalarName?: string;
  enumValues?: { value: string; description: string | null }[];
  children?: FieldSpec[];
  item?: FieldSpec;
  defaultValue?: unknown;
  constraints: Constraints;
  /** Règles affichées sous le champ, en français. */
  rules: string[];
  deprecated: boolean;
}

const MAX_DEPTH = 5;

/** « fullName » → « Full name », « created_at » → « Created at ». */
export function humanize(name: string): string {
  const spaced = name
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : name;
}

function scalarKind(name: string): FieldKind {
  switch (name) {
    case 'String':
      return 'string';
    case 'Int':
      return 'int';
    case 'Float':
      return 'float';
    case 'Boolean':
      return 'boolean';
    case 'ID':
      return 'id';
  }
  const n = name.toLowerCase();
  if (n === 'date' || n === 'localdate') return 'date';
  if (n.includes('datetime') || n.includes('timestamp') || n === 'instant') return 'datetime';
  if (n === 'time' || n === 'localtime') return 'time';
  if (n.includes('json') || n === 'object' || n === 'any') return 'json';
  if (n.includes('upload') || n === 'file') return 'upload';
  if (n.includes('email')) return 'string';
  if (n.includes('url') || n.includes('uri') || n.includes('uuid')) return 'string';
  if (n.includes('int') || n.includes('long') || n.includes('bigint')) return 'int';
  if (n.includes('float') || n.includes('decimal') || n.includes('number')) return 'float';
  return 'custom';
}

/**
 * Lit des contraintes écrites dans la description du schéma
 * (« min: 1 », « max 100 », « between 1 and 100 », « 8 caractères minimum »…).
 */
export function constraintsFromDescription(text: string | null | undefined): Constraints {
  const c: Constraints = {};
  if (!text) return c;
  const t = text.toLowerCase();
  const num = (re: RegExp) => {
    const m = t.match(re);
    return m ? Number(m[1]) : undefined;
  };
  const between = t.match(/(?:between|entre)\s+(-?\d+(?:\.\d+)?)\s+(?:and|et)\s+(-?\d+(?:\.\d+)?)/);
  if (between) {
    c.min = Number(between[1]);
    c.max = Number(between[2]);
  }
  c.minLength ??= num(/min(?:imum)?[\s_-]*length\s*[:=]?\s*(\d+)/) ?? num(/(\d+)\s*caract[eè]res?\s*minimum/) ?? num(/at least\s+(\d+)\s+char/);
  c.maxLength ??= num(/max(?:imum)?[\s_-]*length\s*[:=]?\s*(\d+)/) ?? num(/(\d+)\s*caract[eè]res?\s*max/) ?? num(/at most\s+(\d+)\s+char/);
  c.min ??= num(/\bmin(?:imum)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/);
  c.max ??= num(/\bmax(?:imum)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/);
  if (/\be-?mail\b|courriel/.test(t)) c.format = 'email';
  for (const k of Object.keys(c) as (keyof Constraints)[]) if (c[k] === undefined) delete c[k];
  return c;
}

function formatFromName(name: string, kind: FieldKind): Constraints['format'] {
  if (kind !== 'string' && kind !== 'custom') return undefined;
  const n = name.toLowerCase();
  if (n.includes('email') || n.includes('courriel')) return 'email';
  if (n === 'url' || n.endsWith('url') || n === 'website') return 'url';
  if (n.includes('uuid')) return 'uuid';
  if (n.includes('phone') || n.includes('telephone')) return 'phone';
  return undefined;
}

const KIND_LABEL: Record<FieldKind, string> = {
  string: 'Texte',
  int: 'Nombre entier',
  float: 'Nombre décimal',
  boolean: 'Oui / Non',
  id: 'Identifiant',
  enum: 'Liste de choix',
  date: 'Date',
  datetime: 'Date et heure',
  time: 'Heure',
  json: 'Objet JSON',
  object: 'Groupe de champs',
  list: 'Liste',
  upload: 'Fichier',
  custom: 'Valeur',
};

function plural(n: number, one: string, many: string) {
  return `${n} ${n > 1 ? many : one}`;
}

export function describeRules(spec: Omit<FieldSpec, 'rules'>): string[] {
  const rules: string[] = [spec.required ? 'Obligatoire' : 'Facultatif'];
  const c = spec.constraints;
  if (spec.kind === 'enum' && spec.enumValues) rules.push(plural(spec.enumValues.length, 'choix', 'choix'));
  else if (spec.kind !== 'object') rules.push(KIND_LABEL[spec.kind] + (spec.kind === 'custom' && spec.scalarName ? ` (${spec.scalarName})` : ''));
  if (c.format === 'email') rules.push('Format courriel');
  if (c.format === 'url') rules.push('Adresse web');
  if (c.format === 'uuid') rules.push('Format UUID');
  if (c.minLength !== undefined && c.maxLength !== undefined) rules.push(`${c.minLength} à ${c.maxLength} caractères`);
  else if (c.minLength !== undefined) rules.push(`${plural(c.minLength, 'caractère', 'caractères')} minimum`);
  else if (c.maxLength !== undefined) rules.push(`${plural(c.maxLength, 'caractère', 'caractères')} maximum`);
  if (c.min !== undefined && c.max !== undefined) rules.push(`Entre ${c.min} et ${c.max}`);
  else if (c.min !== undefined) rules.push(`${c.min} ou plus`);
  else if (c.max !== undefined) rules.push(`${c.max} ou moins`);
  if (c.allowed?.length) rules.push(`Valeurs : ${c.allowed.join(', ')}`);
  if (spec.defaultValue !== undefined && spec.defaultValue !== null) rules.push(`Défaut : ${JSON.stringify(spec.defaultValue)}`);
  return rules;
}

function build(
  name: string,
  path: string,
  type: GraphQLInputType,
  description: string | null,
  defaultValue: unknown,
  deprecated: boolean,
  learned: Record<string, LearnedRule>,
  depth: number,
  seen: Set<string>,
): FieldSpec {
  const required = isNonNullType(type);
  const inner = isNonNullType(type) ? type.ofType : type;
  const base = {
    path,
    name,
    label: humanize(name),
    description,
    required,
    typeLabel: String(type),
    defaultValue,
    deprecated,
  };

  let spec: Omit<FieldSpec, 'rules'>;
  if (isListType(inner)) {
    const item = build(name, `${path}[]`, inner.ofType, null, undefined, false, learned, depth + 1, seen);
    spec = { ...base, kind: 'list', item, constraints: {} };
  } else if (isEnumType(inner)) {
    spec = {
      ...base,
      kind: 'enum',
      enumValues: inner.getValues().map((v) => ({ value: v.name, description: v.description ?? null })),
      constraints: {},
    };
  } else if (isInputObjectType(inner)) {
    const children: FieldSpec[] = [];
    if (depth < MAX_DEPTH && !seen.has(inner.name)) {
      const nextSeen = new Set(seen).add(inner.name);
      for (const f of Object.values(inner.getFields()) as GraphQLInputField[]) {
        children.push(
          build(f.name, `${path}.${f.name}`, f.type, f.description ?? null, f.defaultValue, f.deprecationReason != null, learned, depth + 1, nextSeen),
        );
      }
    }
    spec = { ...base, kind: 'object', children, scalarName: inner.name, constraints: {} };
  } else if (isScalarType(inner)) {
    const kind = scalarKind(inner.name);
    spec = { ...base, kind, scalarName: inner.name, constraints: {} };
  } else {
    spec = { ...base, kind: 'custom', constraints: {} };
  }

  const fromDesc = constraintsFromDescription(description);
  const format = formatFromName(name, spec.kind) ?? fromDesc.format;
  const learnedRule = learned[path] ?? learned[name];
  spec.constraints = {
    ...fromDesc,
    ...(format ? { format } : {}),
    ...(learnedRule ? cleanLearned(learnedRule) : {}),
  };
  return { ...spec, rules: describeRules(spec) };
}

function cleanLearned(rule: LearnedRule): Constraints {
  const c: Constraints = {};
  if (rule.minLength !== undefined) c.minLength = rule.minLength;
  if (rule.maxLength !== undefined) c.maxLength = rule.maxLength;
  if (rule.min !== undefined) c.min = rule.min;
  if (rule.max !== undefined) c.max = rule.max;
  if (rule.allowed) c.allowed = rule.allowed;
  if (rule.format === 'email' || rule.format === 'url' || rule.format === 'uuid' || rule.format === 'phone') c.format = rule.format;
  return c;
}

/** Extrait d'une description d'opération ce qui concerne un argument (« take: between 1 and 100 »). */
function argNote(opDescription: string | null | undefined, arg: string): string | null {
  if (!opDescription) return null;
  const m = opDescription.match(new RegExp(`\\b${arg}\\b\\s*[:=-]\\s*([^.;\\n]+)`, 'i'));
  return m ? m[1] : null;
}

/** Transforme les arguments d'une opération en champs de formulaire. */
export function fieldsForArgs(args: readonly GraphQLArgument[], learned: Record<string, LearnedRule> = {}, opDescription?: string | null): FieldSpec[] {
  return args.map((a) => {
    const note = argNote(opDescription, a.name);
    const spec = build(a.name, a.name, a.type, a.description ?? null, a.defaultValue, a.deprecationReason != null, learned, 0, new Set());
    if (!note) return spec;
    // Les règles lues dans la description de l'opération complètent celles de l'argument.
    const extra = constraintsFromDescription(note);
    const constraints = { ...extra, ...spec.constraints };
    const next = { ...spec, constraints };
    return { ...next, rules: describeRules(next) };
  });
}

/** Tous les champs « feuilles » (hors groupes), utile pour les cas limites et les erreurs. */
export function leafFields(fields: FieldSpec[]): FieldSpec[] {
  const out: FieldSpec[] = [];
  const walk = (f: FieldSpec) => {
    if (f.kind === 'object') f.children?.forEach(walk);
    else out.push(f);
  };
  fields.forEach(walk);
  return out;
}
