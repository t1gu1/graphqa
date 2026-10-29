// Accès aux fonctions natives (Tauri), avec un repli « navigateur » pour le
// développement de l'interface avec `npm run dev`.

import { invoke } from '@tauri-apps/api/core';
import type { TransportResult } from './graphql/errors';
import type { AgentId, PersistedState } from './types';

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface GraphqlCall {
  url: string;
  headers: [string, string][];
  body: string;
  timeoutMs?: number;
  insecureTls?: boolean;
}

interface NativeResponse {
  status: number;
  durationMs: number;
  sizeBytes: number;
  body: string;
}

export async function sendGraphql(call: GraphqlCall): Promise<TransportResult> {
  const started = performance.now();
  if (isTauri()) {
    try {
      const r = await invoke<NativeResponse>('graphql_request', { request: call });
      return { ok: true, status: r.status, durationMs: r.durationMs, sizeBytes: r.sizeBytes, body: r.body };
    } catch (e) {
      return { ok: false, error: String(e), durationMs: Math.round(performance.now() - started) };
    }
  }
  try {
    const res = await fetch(call.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/graphql-response+json, application/json',
        ...Object.fromEntries(call.headers.filter(([k]) => k.trim())),
      },
      body: call.body,
    });
    const body = await res.text();
    return {
      ok: true,
      status: res.status,
      durationMs: Math.round(performance.now() - started),
      sizeBytes: new TextEncoder().encode(body).length,
      body,
    };
  } catch (e) {
    return {
      ok: false,
      error: `CONNECT|${String(e)} — dans le navigateur, le serveur doit autoriser CORS. L'application de bureau n'a pas cette limite.`,
      durationMs: Math.round(performance.now() - started),
    };
  }
}

const LOCAL_KEY = 'graphqa:state';

export async function loadState(): Promise<PersistedState | null> {
  try {
    const raw = isTauri() ? await invoke<string | null>('load_state') : localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as PersistedState) : null;
  } catch (e) {
    console.error('Chargement de l’état impossible', e);
    return null;
  }
}

export async function saveState(state: PersistedState): Promise<void> {
  const json = JSON.stringify(state, null, 2);
  try {
    if (isTauri()) await invoke('save_state', { json });
    else localStorage.setItem(LOCAL_KEY, json);
  } catch (e) {
    console.error('Sauvegarde impossible', e);
  }
}

export interface AgentStatus {
  found: boolean;
  version: string | null;
  path: string | null;
  message: string | null;
}

export async function detectAgent(agent: Exclude<AgentId, 'none'>): Promise<AgentStatus> {
  if (!isTauri()) {
    return { found: false, version: null, path: null, message: "L'assistant n'est disponible que dans l'application de bureau." };
  }
  return invoke<AgentStatus>('agent_detect', { agent });
}

export async function askAgent(agent: Exclude<AgentId, 'none'>, prompt: string): Promise<string> {
  if (!isTauri()) throw new Error("FAILED|L'assistant n'est disponible que dans l'application de bureau.");
  return invoke<string>('agent_ask', { agent, prompt });
}

/** Message lisible à partir d'une erreur « CODE|détail » renvoyée par Rust. */
export function readableError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const [code, ...rest] = text.split('|');
  const detail = rest.join('|');
  if (!detail) return text;
  switch (code) {
    case 'NOT_FOUND':
      return `${detail} Suivez la configuration guidée dans Réglages › Assistant IA.`;
    case 'TIMEOUT':
      return detail;
    default:
      return detail;
  }
}

export async function exportTextFile(defaultName: string, contents: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return false;
    await writeTextFile(path, contents);
    return true;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export async function importTextFile(extensions: string[]): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, directory: false, filters: [{ name: 'Fichier', extensions }] });
    if (!path || Array.isArray(path)) return null;
    return readTextFile(path);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((e) => `.${e}`).join(',');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}
