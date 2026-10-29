import type { GraphQLSchema } from 'graphql';
import { create } from 'zustand';
import { defaultState } from '../lib/defaults';
import type { Normalized } from '../lib/graphql/errors';
import type { OperationInfo } from '../lib/graphql/schema';
import type { Values } from '../lib/graphql/values';
import type { AgentStatus } from '../lib/platform';
import type { AgentId, AppSettings, Environment, Expectation, PersistedState, Project } from '../lib/types';

export type Screen = 'workbench' | 'library' | 'settings';
export type SettingsSection = 'projects' | 'roles' | 'agent' | 'theme';
export type RequestTab = 'inputs' | 'out' | 'edges' | 'gql';

export interface SchemaEntry {
  status: 'idle' | 'loading' | 'ready' | 'error';
  schema?: GraphQLSchema;
  operations?: OperationInfo[];
  error?: string;
  at?: number;
  /** Source du schéma (adresse, fichier) : s'il change, on relit le schéma. */
  signature?: string;
}

export interface FormState {
  values: Values;
  selection: string[] | null;
}

export interface RunState {
  running: boolean;
  result?: Normalized;
  document?: string;
  variables?: Values;
  at?: string;
  blocked?: string;
}

export interface EdgeRun {
  running: boolean;
  result?: Normalized;
}

export interface ProposedTest {
  name: string;
  variables: Values;
  expect: Expectation;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  proposal?: { variables?: Values; tests?: ProposedTest[] };
  operation?: string;
  at: string;
}

export interface LibraryView {
  collectionId: string | 'all';
  testId: string | null;
  filter: 'all' | 'fail' | 'pass' | 'example';
  search: string;
}

export interface Store {
  ready: boolean;
  data: PersistedState;
  screen: Screen;
  settingsSection: SettingsSection;
  schemas: Record<string, SchemaEntry>;
  selectedOp: string | null;
  kindFilter: 'all' | 'query' | 'mutation';
  search: string;
  collapsed: Record<string, boolean>;
  tab: RequestTab;
  responseView: 'readable' | 'json';
  showAgent: boolean;
  showSave: boolean;
  forms: Record<string, FormState>;
  runs: Record<string, RunState>;
  edgeRuns: Record<string, Record<string, EdgeRun>>;
  chat: ChatMessage[];
  chatBusy: boolean;
  agentStatus: { checking: boolean; agent?: AgentId; status?: AgentStatus };
  library: LibraryView;
  libraryRunning: boolean;
  toast: { id: number; text: string; tone: 'info' | 'error' } | null;

  hydrate: (data: PersistedState) => void;
  set: (patch: Partial<Store>) => void;
  updateData: (fn: (d: PersistedState) => PersistedState) => void;
  updateProject: (fn: (p: Project) => Project, projectId?: string) => void;
  updateEnvironment: (envId: string, fn: (e: Environment) => Environment) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  notify: (text: string, tone?: 'info' | 'error') => void;
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  data: defaultState(),
  screen: 'workbench',
  settingsSection: 'projects',
  schemas: {},
  selectedOp: null,
  kindFilter: 'all',
  search: '',
  collapsed: {},
  tab: 'inputs',
  responseView: 'readable',
  showAgent: true,
  showSave: false,
  forms: {},
  runs: {},
  edgeRuns: {},
  chat: [],
  chatBusy: false,
  agentStatus: { checking: false },
  library: { collectionId: 'all', testId: null, filter: 'all', search: '' },
  libraryRunning: false,
  toast: null,

  hydrate: (data) => set({ data, ready: true }),
  set: (patch) => set(patch),
  updateData: (fn) => set({ data: fn(get().data) }),
  updateProject: (fn, projectId) =>
    set((s) => {
      const id = projectId ?? s.data.activeProjectId;
      return { data: { ...s.data, projects: s.data.projects.map((p) => (p.id === id ? fn(p) : p)) } };
    }),
  updateEnvironment: (envId, fn) =>
    get().updateProject((p) => ({ ...p, environments: p.environments.map((e) => (e.id === envId ? fn(e) : e)) })),
  updateSettings: (patch) => set((s) => ({ data: { ...s.data, settings: { ...s.data.settings, ...patch } } })),
  notify: (text, tone = 'info') => {
    const id = Date.now();
    set({ toast: { id, text, tone } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 4000);
  },
}));

export function activeProject(s: Pick<Store, 'data'>): Project {
  return s.data.projects.find((p) => p.id === s.data.activeProjectId) ?? s.data.projects[0];
}

export function activeEnvironment(p: Project): Environment {
  return p.environments.find((e) => e.id === p.activeEnvironmentId) ?? p.environments[0];
}

export function schemaKey(projectId: string, envId: string): string {
  return `${projectId}:${envId}`;
}

export function opKey(op: Pick<OperationInfo, 'kind' | 'name'>): string {
  return `${op.kind}:${op.name}`;
}

export function formKey(projectId: string, key: string): string {
  return `${projectId}:${key}`;
}

/** Hook pratique : projet et environnement actifs + schéma correspondant. */
export function useActive() {
  const project = useStore(activeProject);
  const env = activeEnvironment(project);
  const schema = useStore((s) => s.schemas[schemaKey(project.id, env.id)]);
  return { project, env, schema };
}
