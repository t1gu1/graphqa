import type { FieldSpec } from './fields';
import { removeAt, setAt, splitPath, type Values } from './values';

export type EdgeExpectation = 'error' | 'success' | 'unknown';

export interface EdgeCase {
  id: string;
  /** Libellé court, affiché en police mono (ex. « email = "" »). */
  label: string;
  /** Explication en français. */
  detail: string;
  expect: EdgeExpectation;
  path: string[] | null;
  value?: unknown;
  remove?: boolean;
  noAuth?: boolean;
}

const LONG = 10_000;

function walkLeaves(fields: FieldSpec[], visit: (f: FieldSpec) => void) {
  for (const f of fields) {
    if (f.kind === 'object') walkLeaves(f.children ?? [], visit);
    else visit(f);
  }
}

function fmt(n: number): string {
  return n.toLocaleString('fr-CA');
}

/**
 * Cas limites générés à partir des règles connues de chaque champ : valeurs
 * vides, juste à côté des limites, mauvais format… là où les bogues se cachent.
 */
export function edgeCasesFor(fields: FieldSpec[], opts: { hasAuth: boolean; isMutation: boolean }, max = 40): EdgeCase[] {
  const out: EdgeCase[] = [];
  // Identifiant stable (dérivé du libellé) : les résultats restent attachés au bon cas
  // même si la liste change après l'apprentissage d'une nouvelle règle.
  const used = new Set<string>();
  const add = (c: Omit<EdgeCase, 'id'>) => {
    let id = c.label;
    for (let i = 2; used.has(id); i++) id = `${c.label}#${i}`;
    used.add(id);
    out.push({ ...c, id });
  };

  walkLeaves(fields, (f) => {
    const path = splitPath(f.path);
    const name = f.path;
    const c = f.constraints;
    const req = f.required;

    if (req) add({ label: `${name} absent`, detail: 'Champ obligatoire non envoyé', expect: 'error', path, remove: true });

    switch (f.kind) {
      case 'string':
      case 'custom':
      case 'id': {
        add({ label: `${name} = ""`, detail: 'Texte vide', expect: req ? 'error' : 'unknown', path, value: '' });
        add({ label: `${name} = "   "`, detail: 'Seulement des espaces', expect: req ? 'error' : 'unknown', path, value: '   ' });
        if (c.minLength !== undefined && c.minLength > 1)
          add({ label: `${name} × ${c.minLength - 1}`, detail: `Juste sous le minimum (${c.minLength} caractères)`, expect: 'error', path, value: 'x'.repeat(c.minLength - 1) });
        if (c.maxLength !== undefined)
          add({ label: `${name} × ${c.maxLength + 1}`, detail: `Juste au-dessus du maximum (${c.maxLength} caractères)`, expect: 'error', path, value: 'x'.repeat(c.maxLength + 1) });
        else add({ label: `${name} × ${fmt(LONG)}`, detail: `Texte très long (${fmt(LONG)} caractères)`, expect: 'unknown', path, value: 'x'.repeat(LONG) });
        if (c.format === 'email') {
          add({ label: `${name} sans @`, detail: 'Courriel sans arobase', expect: 'error', path, value: 'marie.tremblay' });
          add({ label: `${name} sans domaine`, detail: 'Courriel incomplet', expect: 'error', path, value: 'marie@' });
        }
        if (c.format === 'url') add({ label: `${name} invalide`, detail: "Adresse web sans protocole", expect: 'error', path, value: 'exemple' });
        if (f.kind === 'id') add({ label: `${name} inexistant`, detail: 'Identifiant qui n’existe pas', expect: 'error', path, value: 'inexistant-999999' });
        if (f.kind !== 'id') {
          add({ label: `${name} accents`, detail: 'Accents et caractères spéciaux', expect: 'success', path, value: 'Émilie Ñoño-Ünal « test » 日本' });
          add({ label: `${name} <script>`, detail: 'Code HTML/JavaScript : doit être refusé ou neutralisé', expect: 'unknown', path, value: '<script>alert(1)</script>' });
        }
        break;
      }
      case 'int': {
        if (c.min !== undefined) add({ label: `${name} = ${c.min - 1}`, detail: `Juste sous le minimum (${c.min})`, expect: 'error', path, value: c.min - 1 });
        else {
          add({ label: `${name} = 0`, detail: 'Zéro', expect: 'unknown', path, value: 0 });
          add({ label: `${name} = -1`, detail: 'Nombre négatif', expect: 'unknown', path, value: -1 });
        }
        if (c.max !== undefined) add({ label: `${name} = ${c.max + 1}`, detail: `Juste au-dessus du maximum (${c.max})`, expect: 'error', path, value: c.max + 1 });
        add({ label: `${name} = 2147483648`, detail: 'Au-delà de la limite des nombres entiers', expect: 'error', path, value: 2147483648 });
        add({ label: `${name} = 1.5`, detail: 'Nombre à virgule au lieu d’un entier', expect: 'error', path, value: 1.5 });
        break;
      }
      case 'float': {
        if (c.min !== undefined) add({ label: `${name} = ${c.min - 0.01}`, detail: `Juste sous le minimum (${c.min})`, expect: 'error', path, value: c.min - 0.01 });
        else add({ label: `${name} = -0.01`, detail: 'Nombre négatif', expect: 'unknown', path, value: -0.01 });
        if (c.max !== undefined) add({ label: `${name} = ${c.max + 0.01}`, detail: `Juste au-dessus du maximum (${c.max})`, expect: 'error', path, value: c.max + 0.01 });
        add({ label: `${name} = 1e15`, detail: 'Très grand nombre', expect: 'unknown', path, value: 1e15 });
        break;
      }
      case 'enum':
        add({ label: `${name} = VALEUR_INEXISTANTE`, detail: 'Choix qui ne fait pas partie de la liste', expect: 'error', path, value: 'VALEUR_INEXISTANTE' });
        break;
      case 'date':
      case 'datetime':
        add({ label: `${name} = 2026-13-45`, detail: 'Date impossible', expect: 'error', path, value: f.kind === 'date' ? '2026-13-45' : '2026-13-45T25:61:00Z' });
        add({ label: `${name} = 1900-01-01`, detail: 'Date très ancienne', expect: 'unknown', path, value: f.kind === 'date' ? '1900-01-01' : '1900-01-01T00:00:00Z' });
        add({ label: `${name} = 2999-12-31`, detail: 'Date très lointaine', expect: 'unknown', path, value: f.kind === 'date' ? '2999-12-31' : '2999-12-31T00:00:00Z' });
        break;
      case 'list':
        add({ label: `${name} = []`, detail: 'Liste vide', expect: req ? 'unknown' : 'success', path, value: [] });
        break;
      default:
        break;
    }
  });

  if (opts.hasAuth)
    out.push({
      id: 'sans jeton',
      label: 'sans jeton',
      detail: 'Requête envoyée sans authentification',
      expect: opts.isMutation ? 'error' : 'unknown',
      path: null,
      noAuth: true,
    });

  return out.slice(0, max);
}

export function applyEdgeCase(base: Values, ec: EdgeCase): Values {
  if (!ec.path) return base;
  return ec.remove ? removeAt(base, ec.path) : setAt(base, ec.path, ec.value);
}

export const EXPECT_LABEL: Record<EdgeExpectation, string> = {
  error: 'une erreur',
  success: 'un succès',
  unknown: 'à vérifier',
};
