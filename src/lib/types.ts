// Modèle de données persistant de GraphQA.

export type Theme = 'light' | 'dark';
export type AgentId = 'claude' | 'copilot' | 'none';
export type OperationKind = 'query' | 'mutation';

export interface HeaderEntry {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

/** Un rôle permet de tester avec des droits différents (jeton par environnement). */
export interface Role {
  id: string;
  name: string;
}

export interface Environment {
  id: string;
  name: string;
  url: string;
  headers: HeaderEntry[];
  /** Jeton par rôle (clé = id du rôle). Vide = pas d'authentification. */
  tokens: Record<string, string>;
  readOnly: boolean;
  insecureTls: boolean;
  color: string;
}

export interface Collection {
  id: string;
  name: string;
}

export type Expectation = 'success' | 'error' | 'none';

export interface CheckResult {
  label: string;
  ok: boolean;
}

export interface RunRecord {
  at: string;
  environment: string;
  status: 'pass' | 'fail' | 'none';
  httpStatus: number;
  durationMs: number;
  summary: string;
  checks: CheckResult[];
}

export interface SavedTest {
  id: string;
  collectionId: string;
  name: string;
  operation: string;
  kind: OperationKind;
  type: 'test' | 'example';
  expect: Expectation;
  /** Code d'erreur attendu (ex. BAD_USER_INPUT) quand le test doit échouer. */
  expectedErrorCode?: string;
  variables: Record<string, unknown>;
  selection: string[];
  roleId: string | null;
  createdAt: string;
  lastRun?: RunRecord;
}

/** Règle apprise depuis un message d'erreur du serveur (ex. longueur minimale). */
export interface LearnedRule {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  format?: string;
  allowed?: string[];
}

export interface Project {
  id: string;
  name: string;
  environments: Environment[];
  activeEnvironmentId: string;
  roles: Role[];
  activeRoleId: string | null;
  /** Noms affichés des groupes d'opérations (clé = groupe détecté). */
  groupNames: Record<string, string>;
  /** « introspection » : le schéma est lu sur l'API ; « file » : un fichier .graphql importé. */
  schemaSource: 'introspection' | 'file';
  schemaSdl?: string;
  collections: Collection[];
  tests: SavedTest[];
  /** Règles apprises : opération → chemin du champ → règle. */
  learned: Record<string, Record<string, LearnedRule>>;
}

export interface AgentContextSettings {
  schema: boolean;
  request: boolean;
  library: boolean;
}

export interface AppSettings {
  theme: Theme;
  agent: AgentId;
  agentContext: AgentContextSettings;
}

export interface PersistedState {
  version: 1;
  projects: Project[];
  activeProjectId: string;
  settings: AppSettings;
}
