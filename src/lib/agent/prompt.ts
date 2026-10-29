import { getNamedType, isEnumType, isInputObjectType, printType, type GraphQLNamedType, type GraphQLSchema } from 'graphql';
import type { Normalized } from '../graphql/errors';
import type { FieldSpec } from '../graphql/fields';
import { operationSignature, type OperationInfo } from '../graphql/schema';
import type { Values } from '../graphql/values';
import type { AgentContextSettings, Expectation, SavedTest } from '../types';

export type AgentIntent = 'explain' | 'tests' | 'bug' | 'free';

export const INTENT_LABEL: Record<Exclude<AgentIntent, 'free'>, string> = {
  explain: "Expliquer l'erreur",
  tests: 'Proposer des cas de test',
  bug: 'Rapport de bogue',
};

export interface PromptInput {
  intent: AgentIntent;
  question?: string;
  schema?: GraphQLSchema;
  op?: OperationInfo;
  fields?: FieldSpec[];
  variables?: Values;
  document?: string;
  result?: Normalized;
  environment?: string;
  tests?: SavedTest[];
  context: AgentContextSettings;
}

const MAX_RAW = 4000;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (tronqué)` : text;
}

/** Types d'entrée (input, enum) utilisés par l'opération, en SDL. */
function inputTypesSdl(schema: GraphQLSchema, op: OperationInfo): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (t: GraphQLNamedType) => {
    if (seen.has(t.name) || out.length > 25) return;
    seen.add(t.name);
    if (isInputObjectType(t)) {
      out.push(printType(t));
      for (const f of Object.values(t.getFields())) visit(getNamedType(f.type));
    } else if (isEnumType(t)) {
      out.push(printType(t));
    }
  };
  for (const a of op.args) visit(getNamedType(a.type));
  void schema;
  return out.join('\n\n');
}

function rulesList(fields: FieldSpec[], prefix = ''): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    const label = prefix ? `${prefix}.${f.name}` : f.name;
    if (f.kind === 'object') lines.push(...rulesList(f.children ?? [], label));
    else lines.push(`- ${label} (${f.typeLabel}) : ${f.rules.join(', ')}`);
  }
  return lines;
}

const INSTRUCTIONS: Record<AgentIntent, string> = {
  explain: [
    'Explique pourquoi on a obtenu cette réponse.',
    "Dis clairement s'il s'agit d'un comportement attendu (le serveur refuse correctement une donnée invalide) ou d'un bogue probable.",
    "Si des valeurs corrigées permettraient de réussir, termine par un bloc ```json {\"variables\": { … } }``` contenant TOUTES les variables corrigées, prêtes à être renvoyées telles quelles.",
  ].join('\n'),
  tests: [
    "Propose entre 5 et 8 cas de test utiles pour cette opération : un ou deux cas qui doivent réussir, et des cas qui doivent échouer (valeurs limites, formats invalides, droits).",
    'Explique le choix en deux ou trois phrases, puis termine par un bloc ```json {"tests": [{"name": "…", "expect": "success" | "error", "variables": { … }}]}```.',
    'Les noms de tests sont courts, en français, au format « opération — situation ».',
  ].join('\n'),
  bug: [
    'Rédige un rapport de bogue concis en Markdown avec ces sections : Titre, Environnement, Étapes pour reproduire, Résultat attendu, Résultat obtenu, Données envoyées.',
    "N'invente rien qui ne soit pas dans le contexte. N'inclus aucun jeton ni mot de passe réel.",
  ].join('\n'),
  free: 'Réponds à la question de la personne.',
};

export function buildPrompt(input: PromptInput): string {
  const parts: string[] = [
    "Tu es l'assistant QA de GraphQA, un outil pour tester une API GraphQL.",
    'La personne qui te parle fait de l’assurance qualité et n’est pas forcément développeuse.',
    'Réponds en français, en phrases courtes et sans jargon inutile. Pas plus de 200 mots hors bloc JSON. Ne propose pas de code sauf si on te le demande.',
    "N'utilise aucun outil et ne lis aucun fichier : tout le contexte utile est ci-dessous.",
    '',
  ];

  if (input.op) {
    parts.push('## Opération', operationSignature(input.op));
    if (input.op.description) parts.push(`Description : ${input.op.description}`);
    if (input.fields?.length) parts.push('', '## Règles connues des champs', ...rulesList(input.fields));
    if (input.context.schema && input.schema) {
      const sdl = inputTypesSdl(input.schema, input.op);
      if (sdl) parts.push('', '## Types utilisés (extrait du schéma)', '```graphql', truncate(sdl, 4000), '```');
    }
  }

  if (input.context.request) {
    if (input.environment) parts.push('', `Environnement : ${input.environment}`);
    if (input.document) parts.push('', '## Requête envoyée', '```graphql', input.document, '```');
    if (input.variables) parts.push('', '## Variables envoyées', '```json', truncate(JSON.stringify(input.variables, null, 2), 3000), '```');
    if (input.result) {
      const r = input.result;
      parts.push('', '## Réponse obtenue', `Résultat : ${r.title} (HTTP ${r.httpStatus ?? 'aucune réponse'}${r.codes.length ? `, codes : ${r.codes.join(', ')}` : ''})`);
      for (const i of r.issues) parts.push(`- ${i.field ? `${i.field} : ` : ''}${i.original}`);
      parts.push('```json', truncate(r.raw, MAX_RAW), '```');
    }
  }

  if (input.context.library && input.tests?.length) {
    parts.push('', '## Tests déjà enregistrés pour cette opération');
    for (const t of input.tests.slice(0, 20)) {
      parts.push(`- ${t.name} (attendu : ${t.expect}${t.lastRun ? `, dernier résultat : ${t.lastRun.status}` : ''})`);
    }
  }

  parts.push('', '## Demande', INSTRUCTIONS[input.intent]);
  if (input.question) parts.push('', `Question : ${input.question}`);
  return parts.join('\n');
}

export interface Proposal {
  variables?: Values;
  tests?: { name: string; variables: Values; expect: Expectation }[];
}

/** Extrait le dernier bloc JSON de la réponse de l'assistant et le retire du texte affiché. */
export function parseProposal(text: string): { text: string; proposal?: Proposal } {
  const blocks = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    try {
      const parsed = JSON.parse(block[1]) as Record<string, unknown>;
      const proposal: Proposal = {};
      if (parsed.variables && typeof parsed.variables === 'object' && !Array.isArray(parsed.variables)) {
        proposal.variables = parsed.variables as Values;
      }
      if (Array.isArray(parsed.tests)) {
        proposal.tests = parsed.tests
          .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
          .map((t, n) => ({
            name: typeof t.name === 'string' ? t.name : `Cas proposé ${n + 1}`,
            variables: t.variables && typeof t.variables === 'object' ? (t.variables as Values) : {},
            expect: t.expect === 'error' ? 'error' : 'success',
          }));
      }
      if (proposal.variables || proposal.tests?.length) {
        const cleaned = (text.slice(0, block.index) + text.slice((block.index ?? 0) + block[0].length)).trim();
        return { text: cleaned, proposal };
      }
    } catch {
      // bloc non JSON : on l'ignore
    }
  }
  return { text };
}
