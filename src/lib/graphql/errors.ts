import type { LearnedRule } from '../types';

export type Outcome = 'success' | 'partial' | 'error' | 'network';

export interface Issue {
  /** Chemin du champ concerné (« input.email », « email »…) si on a pu le déduire. */
  field: string | null;
  message: string;
  original: string;
  code?: string;
}

export interface Normalized {
  outcome: Outcome;
  httpStatus: number | null;
  durationMs: number | null;
  sizeBytes: number | null;
  title: string;
  subtitle: string;
  codes: string[];
  issues: Issue[];
  data: unknown;
  json: unknown;
  raw: string;
  learned: { field: string; rule: LearnedRule }[];
}

export type TransportResult =
  | { ok: true; status: number; durationMs: number; sizeBytes: number; body: string }
  | { ok: false; error: string; durationMs?: number };

const CODE_TITLES: Record<string, string> = {
  BAD_USER_INPUT: 'Données refusées par le serveur',
  BAD_REQUEST: 'Données refusées par le serveur',
  GRAPHQL_VALIDATION_FAILED: 'Requête refusée : elle ne correspond pas au schéma',
  GRAPHQL_PARSE_FAILED: 'Requête mal formée',
  UNAUTHENTICATED: 'Authentification requise',
  UNAUTHORIZED: 'Authentification requise',
  FORBIDDEN: 'Accès refusé',
  NOT_FOUND: 'Élément introuvable',
  CONFLICT: 'Conflit avec des données existantes',
  INTERNAL_SERVER_ERROR: 'Erreur interne du serveur',
  PERSISTED_QUERY_NOT_FOUND: 'Requête persistée inconnue',
  TOO_MANY_REQUESTS: 'Trop de requêtes',
};

interface Translation {
  field: string | null;
  message: string;
  rule?: LearnedRule;
}

type Rule = [RegExp, (m: RegExpMatchArray) => Translation];

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Messages de validation courants (class-validator, Joi, Zod, graphql-js…), traduits en français. */
const RULES: Rule[] = [
  [/^(?:property )?([\w.[\]]+) should not exist$/, (m) => ({ field: m[1], message: "Ce champ n'est pas accepté par le serveur." })],
  [/^([\w.[\]]+) must be an email$/i, (m) => ({ field: m[1], message: 'Doit être une adresse courriel valide (ex. nom@domaine.com).', rule: { format: 'email' } })],
  [
    /^([\w.[\]]+) must be longer than or equal to (\d+) and shorter than or equal to (\d+) characters$/,
    (m) => ({
      field: m[1],
      message: `Doit contenir entre ${m[2]} et ${m[3]} caractères.`,
      rule: { minLength: Number(m[2]), maxLength: Number(m[3]) },
    }),
  ],
  [/^([\w.[\]]+) must be longer than or equal to (\d+) characters?$/, (m) => ({ field: m[1], message: `Doit contenir au moins ${plural(Number(m[2]), 'caractère')}.`, rule: { minLength: Number(m[2]) } })],
  [/^([\w.[\]]+) must be shorter than or equal to (\d+) characters?$/, (m) => ({ field: m[1], message: `Doit contenir au plus ${plural(Number(m[2]), 'caractère')}.`, rule: { maxLength: Number(m[2]) } })],
  [/^([\w.[\]]+) must not be less than (-?[\d.]+)$/, (m) => ({ field: m[1], message: `Doit être supérieur ou égal à ${m[2]}.`, rule: { min: Number(m[2]) } })],
  [/^([\w.[\]]+) must not be greater than (-?[\d.]+)$/, (m) => ({ field: m[1], message: `Doit être inférieur ou égal à ${m[2]}.`, rule: { max: Number(m[2]) } })],
  [/^([\w.[\]]+) should not be empty$/, (m) => ({ field: m[1], message: 'Ne doit pas être vide.' })],
  [/^([\w.[\]]+) must be a string$/, (m) => ({ field: m[1], message: 'Doit être du texte.' })],
  [/^([\w.[\]]+) must be an integer number$/, (m) => ({ field: m[1], message: 'Doit être un nombre entier.' })],
  [/^([\w.[\]]+) must be a number conforming to the specified constraints$/, (m) => ({ field: m[1], message: 'Doit être un nombre.' })],
  [/^([\w.[\]]+) must be a positive number$/, (m) => ({ field: m[1], message: 'Doit être un nombre positif.', rule: { min: 0 } })],
  [/^([\w.[\]]+) must be a negative number$/, (m) => ({ field: m[1], message: 'Doit être un nombre négatif.' })],
  [/^([\w.[\]]+) must be a boolean value$/, (m) => ({ field: m[1], message: 'Doit être Oui ou Non.' })],
  [/^([\w.[\]]+) must be a (?:valid ISO 8601 date string|Date instance)$/, (m) => ({ field: m[1], message: 'Doit être une date valide.' })],
  [
    /^([\w.[\]]+) must be one of the following values: (.+)$/,
    (m) => {
      const allowed = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      return { field: m[1], message: `Doit être l'une de ces valeurs : ${allowed.join(', ')}.`, rule: { allowed } };
    },
  ],
  [/^([\w.[\]]+) must be a valid enum value$/, (m) => ({ field: m[1], message: "Cette valeur ne fait pas partie des choix autorisés." })],
  [/^([\w.[\]]+) must be (?:a|an) URL address$/, (m) => ({ field: m[1], message: 'Doit être une adresse web valide (ex. https://exemple.com).', rule: { format: 'url' } })],
  [/^([\w.[\]]+) must be a UUID$/, (m) => ({ field: m[1], message: 'Doit être un identifiant UUID valide.', rule: { format: 'uuid' } })],
  [/^([\w.[\]]+) must be a valid phone number$/, (m) => ({ field: m[1], message: 'Doit être un numéro de téléphone valide.', rule: { format: 'phone' } })],
  [/^([\w.[\]]+) must match .+ regular expression$/, (m) => ({ field: m[1], message: "Le format n'est pas accepté." })],
  [/^([\w.[\]]+) must be an array$/, (m) => ({ field: m[1], message: 'Doit être une liste.' })],
  [/^([\w.[\]]+) must contain at least (\d+) elements?$/, (m) => ({ field: m[1], message: `Doit contenir au moins ${plural(Number(m[2]), 'élément')}.` })],
  [/^([\w.[\]]+) must contain (?:not more than|no more than) (\d+) elements?$/, (m) => ({ field: m[1], message: `Doit contenir au plus ${plural(Number(m[2]), 'élément')}.` })],
  [/^"?([\w.[\]]+)"? is required$/i, (m) => ({ field: m[1], message: 'Champ obligatoire.' })],
];

/** Messages de graphql-js lors de la validation des variables. */
function translateGraphqlJs(msg: string): Translation | null {
  let field: string | null = null;
  const at = msg.match(/at "([\w.[\]]+)"/);
  const variable = msg.match(/^Variable "\$(\w+)"/);
  if (at) field = at[1];
  else if (variable) field = variable[1];

  const nested = msg.match(/Field "(\w+)" of required type "([^"]+)" was not provided/);
  if (nested) {
    const base = at ? at[1] : variable ? variable[1] : null;
    return { field: base ? `${base}.${nested[1]}` : nested[1], message: 'Champ obligatoire manquant.' };
  }
  if (/of required type "[^"]+" was not provided/.test(msg)) return { field, message: 'Champ obligatoire manquant.' };
  if (/of non-null type "[^"]+" must not be null/.test(msg)) return { field, message: 'Ne doit pas être vide (null).' };
  if (/Int cannot represent non 32-bit signed integer/.test(msg)) return { field, message: 'Nombre trop grand : la limite est 2 147 483 647.' };
  if (/Int cannot represent non-integer value/.test(msg)) return { field, message: 'Doit être un nombre entier (sans décimales).' };
  if (/(Int|Float) cannot represent non numeric value/.test(msg)) return { field, message: 'Doit être un nombre.' };
  if (/String cannot represent a non string value/.test(msg)) return { field, message: 'Doit être du texte.' };
  if (/Boolean cannot represent a non boolean value/.test(msg)) return { field, message: 'Doit être Oui ou Non.' };
  if (/ID cannot represent value/.test(msg)) return { field, message: "N'est pas un identifiant valide." };
  const enumMatch = msg.match(/Value "([^"]+)" does not exist in "(\w+)" enum/);
  if (enumMatch) return { field, message: `« ${enumMatch[1]} » ne fait pas partie des choix autorisés.` };
  const unknown = msg.match(/Field "(\w+)" is not defined by type "(\w+)"/);
  if (unknown) return { field: field ? `${field}.${unknown[1]}` : unknown[1], message: "Ce champ n'existe pas dans le schéma." };
  if (/Cannot query field "(\w+)" on type/.test(msg)) return { field: null, message: "Une information demandée n'existe pas (le schéma a peut-être changé : rescannez-le)." };
  if (/^Syntax Error/.test(msg)) return { field: null, message: 'La requête est mal formée.' };
  if (at || variable) {
    const expected = msg.match(/Expected type "([^"]+)"/);
    if (expected) return { field, message: `Valeur refusée : le type attendu est ${expected[1]}.` };
  }
  return null;
}

export function translateMessage(msg: string): Translation {
  const trimmed = msg.trim();
  for (const [re, fn] of RULES) {
    const m = trimmed.match(re);
    if (m) return fn(m);
  }
  const g = translateGraphqlJs(trimmed);
  if (g) return g;
  return { field: null, message: trimmed };
}

interface GraphQLErrorLike {
  message?: unknown;
  path?: unknown;
  extensions?: Record<string, unknown>;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

/** Récupère les messages détaillés cachés dans les extensions (NestJS, Apollo, etc.). */
function detailMessages(ext: Record<string, unknown> | undefined): string[] {
  if (!ext) return [];
  const candidates: unknown[] = [];
  const dig = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, unknown>;
    candidates.push(r.message);
    if (r.response && typeof r.response === 'object') candidates.push((r.response as Record<string, unknown>).message);
  };
  dig(ext.originalError);
  dig(ext.exception);
  dig(ext.response);
  candidates.push(ext.validationErrors, ext.errors);
  const out: string[] = [];
  for (const c of candidates) {
    for (const item of asArray(c)) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item === 'object') {
        const r = item as Record<string, unknown>;
        // Format class-validator brut : { property, constraints: { isEmail: "…" } }
        if (r.constraints && typeof r.constraints === 'object') {
          for (const v of Object.values(r.constraints as Record<string, unknown>)) if (typeof v === 'string') out.push(v);
        } else if (typeof r.message === 'string') {
          const field = typeof r.field === 'string' ? r.field : typeof r.path === 'string' ? r.path : null;
          out.push(field && !r.message.includes(field) ? `${field}: ${r.message}` : r.message);
        }
      }
    }
  }
  return out;
}

function errorCode(e: GraphQLErrorLike): string | undefined {
  const ext = e.extensions ?? {};
  const code = ext.code ?? (ext.exception as Record<string, unknown> | undefined)?.code;
  if (typeof code === 'string') return code;
  const status = (ext.originalError as Record<string, unknown> | undefined)?.statusCode ?? ext.status ?? ext.statusCode;
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  return undefined;
}

function issuesFromError(e: GraphQLErrorLike): Issue[] {
  const code = errorCode(e);
  const details = detailMessages(e.extensions);
  const top = typeof e.message === 'string' ? e.message : 'Erreur sans message';
  const generic = /^(Bad Request Exception|Bad Request|Validation failed|Argument Validation Error|Unprocessable Entity)/i.test(top);
  const messages = details.length && (generic || !details.includes(top)) ? details : [top];
  return messages.map((original) => {
    const colon = original.match(/^([\w.[\]]+):\s+(.+)$/);
    const t = colon ? { ...translateMessage(colon[2]), field: colon[1] } : translateMessage(original);
    return { field: t.field, message: t.message, original, code };
  });
}

function nonEmptyData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  return Object.values(data as Record<string, unknown>).some((v) => v !== null && v !== undefined);
}

function describeData(data: unknown): string {
  if (!data || typeof data !== 'object') return 'Aucune donnée';
  const values = Object.values(data as Record<string, unknown>);
  if (values.length !== 1) return `${values.length} résultats`;
  const v = values[0];
  if (v === null || v === undefined) return 'Aucun résultat (null)';
  const list = extractList(v);
  if (list) return `${list.length} résultat${list.length > 1 ? 's' : ''}`;
  if (typeof v === 'object') return '1 résultat';
  return `Valeur : ${JSON.stringify(v)}`;
}

function networkTitle(error: string): { title: string; message: string } {
  const [code, ...rest] = error.split('|');
  const detail = rest.join('|') || error;
  switch (code) {
    case 'TIMEOUT':
      return { title: 'Le serveur ne répond pas', message: 'Aucune réponse dans le délai prévu. Le serveur est peut-être arrêté ou surchargé.' };
    case 'CONNECT':
      return { title: 'Impossible de joindre le serveur', message: "Vérifiez l'adresse de l'environnement et que le serveur est bien démarré." };
    case 'INVALID':
      return { title: 'Adresse ou en-tête invalide', message: detail };
    default:
      return { title: 'La requête n’a pas pu être envoyée', message: detail };
  }
}

export function normalize(result: TransportResult): Normalized {
  if (!result.ok) {
    const { title, message } = networkTitle(result.error);
    return {
      outcome: 'network',
      httpStatus: null,
      durationMs: result.durationMs ?? null,
      sizeBytes: null,
      title,
      subtitle: 'Erreur réseau',
      codes: [],
      issues: [{ field: null, message, original: result.error }],
      data: undefined,
      json: undefined,
      raw: result.error,
      learned: [],
    };
  }

  const base = { httpStatus: result.status, durationMs: result.durationMs, sizeBytes: result.sizeBytes, raw: result.body };
  let json: unknown;
  try {
    json = JSON.parse(result.body);
  } catch {
    const title =
      result.status === 404 ? 'Adresse introuvable (404)' : result.status >= 500 ? 'Erreur du serveur' : 'Réponse inattendue du serveur';
    return {
      ...base,
      outcome: 'error',
      title,
      subtitle: `HTTP ${result.status} · la réponse n'est pas du JSON`,
      codes: [],
      issues: [{ field: null, message: "Le serveur n'a pas répondu en GraphQL. L'adresse de l'environnement est peut-être incorrecte.", original: result.body.slice(0, 500) }],
      data: undefined,
      json: undefined,
      learned: [],
    };
  }

  const obj = (json && typeof json === 'object' ? json : {}) as { data?: unknown; errors?: GraphQLErrorLike[] };
  const errors = Array.isArray(obj.errors) ? obj.errors : [];
  if (!errors.length && result.status < 400) {
    return {
      ...base,
      outcome: 'success',
      title: 'Succès',
      subtitle: describeData(obj.data),
      codes: [],
      issues: [],
      data: obj.data,
      json,
      learned: [],
    };
  }

  const issues = errors.flatMap(issuesFromError);
  const codes = [...new Set(errors.map(errorCode).filter((c): c is string => !!c))];
  if (!errors.length) {
    issues.push({ field: null, message: `Le serveur a répondu avec le statut HTTP ${result.status}.`, original: result.body.slice(0, 500) });
    if (result.status === 401) codes.push('UNAUTHENTICATED');
    if (result.status === 403) codes.push('FORBIDDEN');
  }
  const learned: { field: string; rule: LearnedRule }[] = [];
  for (const i of issues) {
    const t = translateMessage(i.original.replace(/^[\w.[\]]+:\s+/, ''));
    if (t.rule && i.field) learned.push({ field: i.field.split('.').pop() ?? i.field, rule: t.rule });
  }
  const partial = nonEmptyData(obj.data);
  const title = partial ? 'Réponse partielle : certaines informations ont échoué' : (codes.map((c) => CODE_TITLES[c]).find(Boolean) ?? 'Le serveur a renvoyé une erreur');
  const fieldIssues = issues.filter((i) => i.field).length;
  const subtitle =
    fieldIssues > 0
      ? `${fieldIssues} problème${fieldIssues > 1 ? 's' : ''} sur les données envoyées`
      : `${issues.length} erreur${issues.length > 1 ? 's' : ''}`;

  return { ...base, outcome: partial ? 'partial' : 'error', title, subtitle, codes, issues, data: obj.data, json, learned };
}

/** Trouve la liste « principale » d'une réponse (liste directe, edges/node, nodes, items…). */
export function extractList(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const r = v as Record<string, unknown>;
    if (Array.isArray(r.edges)) return r.edges.map((e) => (e && typeof e === 'object' && 'node' in e ? (e as { node: unknown }).node : e));
    for (const k of ['nodes', 'items', 'results', 'data', 'list', 'rows']) if (Array.isArray(r[k])) return r[k] as unknown[];
  }
  return null;
}

export interface Table {
  columns: string[];
  rows: string[][];
  truncated: boolean;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') return '{…}';
  return String(v);
}

/** Met la réponse en tableau lisible (un niveau d'objets imbriqués aplati). */
export function toTable(data: unknown, maxRows = 200): Table | null {
  if (!data || typeof data !== 'object') return null;
  const values = Object.values(data as Record<string, unknown>);
  if (values.length !== 1) return null;
  const root = values[0];
  if (root === null || typeof root !== 'object') return null;
  const list = extractList(root) ?? [root];
  const objects = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
  if (!objects.length) return null;
  const sample = objects.slice(0, 50);
  // Une clé est « aplatie » si au moins une ligne contient un objet à cet endroit.
  const nested = new Set<string>();
  for (const o of sample) for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && !Array.isArray(v)) nested.add(k);
  const columns: string[] = [];
  const addCol = (c: string) => {
    if (!columns.includes(c)) columns.push(c);
  };
  for (const o of sample) {
    for (const [k, v] of Object.entries(o)) {
      if (!nested.has(k)) addCol(k);
      else if (v && typeof v === 'object' && !Array.isArray(v)) for (const sub of Object.keys(v)) addCol(`${k}.${sub}`);
    }
  }
  const rows = objects.slice(0, maxRows).map((o) =>
    columns.map((c) => {
      const [a, b] = c.split('.');
      const v = o[a];
      return cell(b !== undefined && v && typeof v === 'object' ? (v as Record<string, unknown>)[b] : v);
    }),
  );
  return { columns, rows, truncated: objects.length > maxRows };
}
