import type { Environment, PersistedState, Project } from './types';

export function uid(prefix = ''): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}${rnd}`;
}

export const ENV_COLORS = ['#8D8F99', '#2FA36B', '#E8590C', '#5B5BD6', '#0A5CB0', '#C2255C'];

export function newEnvironment(name: string, url: string, color: string, readOnly = false): Environment {
  return {
    id: uid('env-'),
    name,
    url,
    headers: [{ id: uid('h-'), key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
    tokens: {},
    readOnly,
    insecureTls: false,
    color,
  };
}

export function newProject(name = 'Mon projet'): Project {
  const local = newEnvironment('Local', 'http://localhost:3000/graphql', ENV_COLORS[1]);
  // API de démonstration fournie avec le projet (npm run mock).
  const demo = newEnvironment('Démo', 'http://localhost:4000/graphql', ENV_COLORS[0]);
  return {
    id: uid('p-'),
    name,
    environments: [local, demo],
    activeEnvironmentId: local.id,
    roles: [
      { id: uid('r-'), name: 'Utilisateur QA' },
      { id: uid('r-'), name: 'Anonyme' },
    ],
    activeRoleId: null,
    groupNames: {},
    schemaSource: 'introspection',
    collections: [
      { id: uid('c-'), name: 'Exemples' },
      { id: uid('c-'), name: 'Régressions' },
    ],
    tests: [],
    learned: {},
  };
}

export function defaultState(): PersistedState {
  const project = newProject();
  project.activeRoleId = project.roles[0].id;
  return {
    version: 1,
    projects: [project],
    activeProjectId: project.id,
    settings: {
      theme: typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      agent: 'none',
      agentContext: { schema: true, request: true, library: false },
    },
  };
}

/** Complète un état chargé depuis le disque (champs ajoutés dans une version ultérieure). */
export function migrate(state: PersistedState): PersistedState {
  const projects = state.projects.length ? state.projects : [newProject()];
  return {
    ...state,
    projects: projects.map((p) => ({
      ...p,
      schemaSource: p.schemaSource ?? 'introspection',
      roles: p.roles ?? [],
      groupNames: p.groupNames ?? {},
      collections: p.collections?.length ? p.collections : [{ id: uid('c-'), name: 'Exemples' }],
      tests: p.tests ?? [],
      learned: p.learned ?? {},
      environments: p.environments.map((e) => ({ ...e, headers: e.headers ?? [], tokens: e.tokens ?? {} })),
    })),
    activeProjectId: projects.some((p) => p.id === state.activeProjectId) ? state.activeProjectId : projects[0].id,
    settings: {
      theme: state.settings?.theme ?? 'light',
      agent: state.settings?.agent ?? 'none',
      agentContext: state.settings?.agentContext ?? { schema: true, request: true, library: false },
    },
  };
}
