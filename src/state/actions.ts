import { buildSchema, type GraphQLSchema, type IntrospectionQuery } from 'graphql';
import { buildPrompt, parseProposal, type AgentIntent } from '../lib/agent/prompt';
import { uid } from '../lib/defaults';
import { evaluate } from '../lib/graphql/checks';
import { buildDocument } from '../lib/graphql/document';
import { applyEdgeCase, type EdgeCase } from '../lib/graphql/edgeCases';
import { normalize, type Normalized } from '../lib/graphql/errors';
import { fieldsForArgs, type FieldSpec } from '../lib/graphql/fields';
import { INTROSPECTION_QUERY, listOperations, schemaFromIntrospection, type OperationInfo } from '../lib/graphql/schema';
import { defaultSelection, selectionTree, type SelectionNode } from '../lib/graphql/selection';
import { exampleVariables, initialVariables, prepareVariables, type Values } from '../lib/graphql/values';
import { askAgent, detectAgent, readableError, sendGraphql } from '../lib/platform';
import type { AgentId, Environment, Expectation, LearnedRule, Project, SavedTest } from '../lib/types';
import {
  activeEnvironment,
  activeProject,
  formKey,
  opKey,
  schemaKey,
  useStore,
  type ChatMessage,
  type FormState,
  type ProposedTest,
  type SchemaEntry,
} from './store';

// ---------------------------------------------------------------------------
// Contexte d'une opération (champs du formulaire, arbre de sélection)

export interface OpContext {
  key: string;
  op: OperationInfo;
  fields: FieldSpec[];
  tree: SelectionNode[] | null;
  defaultSel: string[];
}

const ctxCache = new WeakMap<GraphQLSchema, Map<string, OpContext>>();

export function getOpContext(entry: SchemaEntry | undefined, key: string | null, project: Project): OpContext | null {
  if (!entry?.schema || !entry.operations || !key) return null;
  const op = entry.operations.find((o) => opKey(o) === key);
  if (!op) return null;
  const learned = project.learned[op.name] ?? {};
  const cacheKey = key + JSON.stringify(learned);
  let byKey = ctxCache.get(entry.schema);
  if (!byKey) {
    byKey = new Map();
    ctxCache.set(entry.schema, byKey);
  }
  let ctx = byKey.get(cacheKey);
  if (!ctx) {
    const tree = selectionTree(entry.schema, op.returnType);
    ctx = { key, op, fields: fieldsForArgs(op.args, learned, op.description), tree, defaultSel: defaultSelection(tree) };
    byKey.set(cacheKey, ctx);
  }
  return ctx;
}

function current() {
  const s = useStore.getState();
  const project = activeProject(s);
  const env = activeEnvironment(project);
  const entry = s.schemas[schemaKey(project.id, env.id)];
  return { s, project, env, entry };
}

export function currentForm(ctx: OpContext, projectId: string): FormState {
  return useStore.getState().forms[formKey(projectId, ctx.key)] ?? { values: initialVariables(ctx.fields), selection: null };
}

// ---------------------------------------------------------------------------
// Transport

export function buildHeaders(env: Environment, roleId: string | null, noAuth = false): [string, string][] {
  const token = !noAuth && roleId ? (env.tokens[roleId] ?? '').trim() : '';
  const out: [string, string][] = [];
  for (const h of env.headers) {
    if (!h.enabled || !h.key.trim()) continue;
    if (h.value.includes('{{token}}')) {
      if (!token) continue;
      out.push([h.key.trim(), h.value.split('{{token}}').join(token)]);
    } else {
      out.push([h.key.trim(), h.value]);
    }
  }
  return out;
}

async function post(env: Environment, roleId: string | null, body: Record<string, unknown>, noAuth = false): Promise<Normalized> {
  const raw = await sendGraphql({
    url: env.url,
    headers: buildHeaders(env, roleId, noAuth),
    body: JSON.stringify(body),
    insecureTls: env.insecureTls,
  });
  return normalize(raw);
}

function operationName(doc: string): string | undefined {
  return doc.match(/^(?:query|mutation)\s+(\w+)/)?.[1];
}

// ---------------------------------------------------------------------------
// Schéma

function introspectionError(r: Normalized): string {
  const text = r.issues.map((i) => i.original).join(' ').toLowerCase();
  if (/introspection|__schema/.test(text)) {
    return "L'introspection est désactivée sur cet environnement (fréquent en production). Importez un fichier de schéma dans Réglages › Projets.";
  }
  return [r.title, r.issues[0]?.message].filter(Boolean).join(' — ');
}

export async function loadSchema(force = false): Promise<void> {
  const { s, project, env, entry } = current();
  const key = schemaKey(project.id, env.id);
  const signature = project.schemaSource === 'file' ? `file:${project.schemaSdl?.length ?? 0}:${project.schemaSdl?.slice(0, 64)}` : `url:${env.url}`;
  if (!force && entry?.signature === signature && (entry.status === 'loading' || entry.status === 'ready')) return;
  const setEntry = (e: SchemaEntry) => useStore.setState((st) => ({ schemas: { ...st.schemas, [key]: { ...e, signature } } }));
  setEntry({ status: 'loading', schema: entry?.schema, operations: entry?.operations });
  try {
    let schema: GraphQLSchema;
    if (project.schemaSource === 'file') {
      if (!project.schemaSdl) throw new Error('Aucun fichier de schéma importé. Ajoutez-en un dans Réglages › Projets.');
      schema = buildSchema(project.schemaSdl);
    } else {
      const res = await post(env, project.activeRoleId, { query: INTROSPECTION_QUERY, operationName: 'IntrospectionQuery' });
      if (res.outcome !== 'success' || !res.data) throw new Error(introspectionError(res));
      schema = schemaFromIntrospection(res.data as IntrospectionQuery);
    }
    const operations = listOperations(schema);
    setEntry({ status: 'ready', schema, operations, at: Date.now() });
    const sel = useStore.getState().selectedOp;
    if (!sel || !operations.some((o) => opKey(o) === sel)) {
      const first = operations[0];
      s.set({ selectedOp: first ? opKey(first) : null });
    }
  } catch (e) {
    setEntry({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Petite requête `{ __typename }` pour vérifier qu'un environnement répond. */
export async function testConnection(env: Environment, roleId: string | null): Promise<Normalized> {
  return post(env, roleId, { query: '{ __typename }' });
}

// ---------------------------------------------------------------------------
// Formulaire

export function setFormValues(ctx: OpContext, values: Values) {
  const { project } = current();
  const fk = formKey(project.id, ctx.key);
  useStore.setState((st) => ({ forms: { ...st.forms, [fk]: { ...currentForm(ctx, project.id), values } } }));
}

export function setSelection(ctx: OpContext, selection: string[]) {
  const { project } = current();
  const fk = formKey(project.id, ctx.key);
  useStore.setState((st) => ({ forms: { ...st.forms, [fk]: { ...currentForm(ctx, project.id), selection } } }));
}

export function fillExample(ctx: OpContext) {
  setFormValues(ctx, exampleVariables(ctx.fields));
}

export function resetForm(ctx: OpContext) {
  setFormValues(ctx, initialVariables(ctx.fields));
}

function learn(project: Project, operation: string, result: Normalized) {
  if (!result.learned.length) return;
  const known = project.learned[operation] ?? {};
  const next: Record<string, LearnedRule> = { ...known };
  for (const { field, rule } of result.learned) next[field] = { ...next[field], ...rule };
  if (JSON.stringify(next) === JSON.stringify(known)) return;
  useStore.getState().updateProject((p) => ({ ...p, learned: { ...p.learned, [operation]: next } }), project.id);
}

const READ_ONLY_MSG = 'Cet environnement est en lecture seule : les mutations sont bloquées. Changez d’environnement ou modifiez ce réglage.';

// ---------------------------------------------------------------------------
// Exécution

export async function runOperation(ctx: OpContext): Promise<void> {
  const { project, env } = current();
  const fk = formKey(project.id, ctx.key);
  const setRun = (r: Partial<import('./store').RunState>) =>
    useStore.setState((st) => ({ runs: { ...st.runs, [fk]: { ...(st.runs[fk] ?? { running: false }), ...r } } }));

  if (ctx.op.kind === 'mutation' && env.readOnly) {
    setRun({ running: false, blocked: READ_ONLY_MSG });
    return;
  }
  const form = currentForm(ctx, project.id);
  const variables = prepareVariables(ctx.fields, form.values);
  const selection = form.selection ?? ctx.defaultSel;
  const document = buildDocument(ctx.op, ctx.tree, selection, variables);
  setRun({ running: true, blocked: undefined });
  const result = await post(env, project.activeRoleId, { query: document, variables, operationName: operationName(document) });
  setRun({ running: false, result, document, variables, at: new Date().toISOString() });
  useStore.setState({ responseView: 'readable' });
  learn(project, ctx.op.name, result);
}

export async function runEdgeCase(ctx: OpContext, ec: EdgeCase): Promise<void> {
  const { project, env } = current();
  const fk = formKey(project.id, ctx.key);
  const setEdge = (patch: { running: boolean; result?: Normalized }) =>
    useStore.setState((st) => ({ edgeRuns: { ...st.edgeRuns, [fk]: { ...st.edgeRuns[fk], [ec.id]: { ...st.edgeRuns[fk]?.[ec.id], ...patch } } } }));
  if (ctx.op.kind === 'mutation' && env.readOnly) {
    useStore.getState().notify(READ_ONLY_MSG, 'error');
    return;
  }
  const form = currentForm(ctx, project.id);
  const variables = applyEdgeCase(prepareVariables(ctx.fields, form.values), ec);
  const document = buildDocument(ctx.op, ctx.tree, form.selection ?? ctx.defaultSel, variables);
  setEdge({ running: true });
  const result = await post(env, project.activeRoleId, { query: document, variables, operationName: operationName(document) }, ec.noAuth);
  setEdge({ running: false, result });
  learn(project, ctx.op.name, result);
}

export async function runAllEdgeCases(ctx: OpContext, cases: EdgeCase[]): Promise<void> {
  for (const ec of cases) await runEdgeCase(ctx, ec);
}

export type EdgeVerdict = 'ok' | 'warn' | 'info';

export function edgeVerdict(ec: EdgeCase, r: Normalized): { verdict: EdgeVerdict; text: string } {
  const refused = r.outcome !== 'success';
  if (r.outcome === 'network') return { verdict: 'info', text: r.title };
  if (ec.expect === 'error') return refused ? { verdict: 'ok', text: `Refusé${r.codes[0] ? ` · ${r.codes[0]}` : ''}` } : { verdict: 'warn', text: 'Accepté, alors qu’une erreur était attendue' };
  if (ec.expect === 'success') return refused ? { verdict: 'warn', text: `Refusé : ${r.issues[0]?.message ?? r.title}` } : { verdict: 'ok', text: 'Accepté' };
  return { verdict: 'info', text: refused ? `Refusé${r.codes[0] ? ` · ${r.codes[0]}` : ''}` : 'Accepté : vérifiez que c’est normal' };
}

// ---------------------------------------------------------------------------
// Bibliothèque

export function saveCurrentAsTest(ctx: OpContext, opts: { name: string; collectionId: string; expect: Expectation; type: 'test' | 'example' }) {
  const { s, project } = current();
  const fk = formKey(project.id, ctx.key);
  const form = currentForm(ctx, project.id);
  const lastResult = s.runs[fk]?.result;
  const test: SavedTest = {
    id: uid('t-'),
    collectionId: opts.collectionId,
    name: opts.name.trim() || ctx.op.name,
    operation: ctx.op.name,
    kind: ctx.op.kind,
    type: opts.type,
    expect: opts.type === 'example' ? 'none' : opts.expect,
    expectedErrorCode: opts.expect === 'error' ? lastResult?.codes[0] : undefined,
    variables: prepareVariables(ctx.fields, form.values),
    selection: form.selection ?? ctx.defaultSel,
    roleId: project.activeRoleId,
    createdAt: new Date().toISOString(),
  };
  s.updateProject((p) => ({ ...p, tests: [...p.tests, test] }));
  s.notify(`« ${test.name} » enregistré dans la bibliothèque.`);
}

export function addProposedTests(ctx: OpContext, tests: ProposedTest[]) {
  const { s, project } = current();
  const collectionId =
    s.library.collectionId !== 'all' && project.collections.some((c) => c.id === s.library.collectionId)
      ? s.library.collectionId
      : project.collections[0]?.id;
  if (!collectionId) return;
  const created: SavedTest[] = tests.map((t) => ({
    id: uid('t-'),
    collectionId,
    name: t.name,
    operation: ctx.op.name,
    kind: ctx.op.kind,
    type: 'test',
    expect: t.expect,
    variables: t.variables,
    selection: currentForm(ctx, project.id).selection ?? ctx.defaultSel,
    roleId: project.activeRoleId,
    createdAt: new Date().toISOString(),
  }));
  s.updateProject((p) => ({ ...p, tests: [...p.tests, ...created] }));
  s.notify(`${created.length} test${created.length > 1 ? 's' : ''} ajouté${created.length > 1 ? 's' : ''} à la bibliothèque.`);
}

async function ensureSchema(): Promise<SchemaEntry | undefined> {
  await loadSchema();
  return current().entry;
}

export async function runTest(testId: string): Promise<void> {
  const entry = await ensureSchema();
  const { project, env } = current();
  const test = project.tests.find((t) => t.id === testId);
  if (!test) return;
  const save = (lastRun: SavedTest['lastRun']) =>
    useStore.getState().updateProject((p) => ({ ...p, tests: p.tests.map((t) => (t.id === testId ? { ...t, lastRun } : t)) }), project.id);

  const ctx = getOpContext(entry, `${test.kind}:${test.operation}`, project);
  if (!ctx) {
    save({ at: new Date().toISOString(), environment: env.name, status: 'fail', httpStatus: 0, durationMs: 0, summary: `L’opération ${test.operation} n’existe plus dans le schéma.`, checks: [] });
    return;
  }
  if (test.kind === 'mutation' && env.readOnly) {
    save({ at: new Date().toISOString(), environment: env.name, status: 'none', httpStatus: 0, durationMs: 0, summary: 'Non lancé : environnement en lecture seule.', checks: [] });
    return;
  }
  const document = buildDocument(ctx.op, ctx.tree, test.selection, test.variables);
  const result = await post(env, test.roleId ?? project.activeRoleId, { query: document, variables: test.variables, operationName: operationName(document) });
  save(evaluate(test.expect, test.expectedErrorCode, test.operation, result, env.name));
}

export async function runTests(ids: string[]): Promise<void> {
  const s = useStore.getState();
  if (s.libraryRunning) return;
  s.set({ libraryRunning: true });
  try {
    for (const id of ids) await runTest(id);
  } finally {
    useStore.getState().set({ libraryRunning: false });
  }
}

export function openTestInWorkbench(testId: string) {
  const { s, project } = current();
  const test = project.tests.find((t) => t.id === testId);
  if (!test) return;
  const key = `${test.kind}:${test.operation}`;
  if (test.roleId && project.roles.some((r) => r.id === test.roleId)) s.updateProject((p) => ({ ...p, activeRoleId: test.roleId }));
  useStore.setState((st) => ({
    forms: { ...st.forms, [formKey(project.id, key)]: { values: structuredClone(test.variables), selection: [...test.selection] } },
    selectedOp: key,
    screen: 'workbench',
    tab: 'inputs',
    kindFilter: 'all',
  }));
}

// ---------------------------------------------------------------------------
// Assistant IA

export async function checkAgent(agent: AgentId): Promise<void> {
  if (agent === 'none') return;
  useStore.setState({ agentStatus: { checking: true, agent } });
  try {
    const status = await detectAgent(agent);
    useStore.setState({ agentStatus: { checking: false, agent, status } });
  } catch (e) {
    useStore.setState({ agentStatus: { checking: false, agent, status: { found: false, version: null, path: null, message: readableError(e) } } });
  }
}

export async function askAssistant(intent: AgentIntent, question?: string, ctx?: OpContext | null): Promise<void> {
  const { s, project, env, entry } = current();
  const agent = s.data.settings.agent;
  if (agent === 'none' || s.chatBusy) return;
  const fk = ctx ? formKey(project.id, ctx.key) : null;
  const run = fk ? s.runs[fk] : undefined;
  const form = ctx ? currentForm(ctx, project.id) : undefined;
  const prompt = buildPrompt({
    intent,
    question,
    schema: entry?.schema,
    op: ctx?.op,
    fields: ctx?.fields,
    variables: run?.variables ?? (ctx && form ? prepareVariables(ctx.fields, form.values) : undefined),
    document: run?.document,
    result: run?.result,
    environment: env.name,
    tests: ctx ? project.tests.filter((t) => t.operation === ctx.op.name) : undefined,
    context: s.data.settings.agentContext,
  });

  const labels: Record<AgentIntent, string> = {
    explain: "Expliquer l'erreur",
    tests: 'Proposer des cas de test',
    bug: 'Rédiger un rapport de bogue',
    free: question ?? '',
  };
  const push = (m: Omit<ChatMessage, 'id' | 'at'>) =>
    useStore.setState((st) => ({ chat: [...st.chat, { ...m, id: uid('m-'), at: new Date().toISOString() }] }));

  push({ role: 'user', text: labels[intent], operation: ctx?.op.name });
  useStore.setState({ chatBusy: true });
  try {
    const answer = await askAgent(agent, prompt);
    const { text, proposal } = parseProposal(answer);
    push({ role: 'assistant', text, proposal, operation: ctx?.op.name });
  } catch (e) {
    push({ role: 'error', text: readableError(e) });
  } finally {
    useStore.setState({ chatBusy: false });
  }
}

export async function applyProposal(ctx: OpContext, variables: Values): Promise<void> {
  setFormValues(ctx, structuredClone(variables));
  useStore.setState({ tab: 'inputs' });
  await runOperation(ctx);
}
