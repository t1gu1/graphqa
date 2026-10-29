import type { CheckResult, Expectation, RunRecord } from '../types';
import type { Normalized } from './errors';

/** Vérifications d'un test enregistré, à partir de la réponse obtenue. */
export function evaluate(
  expect: Expectation,
  expectedCode: string | undefined,
  operation: string,
  result: Normalized,
  environment: string,
): RunRecord {
  const checks: CheckResult[] = [];
  const errored = result.outcome === 'error' || result.outcome === 'partial' || result.outcome === 'network';

  if (expect === 'success') {
    checks.push({ label: 'Ne retourne aucune erreur', ok: !errored });
    const value = result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>)[operation] : undefined;
    checks.push({ label: `Le résultat de ${operation} est présent`, ok: value !== null && value !== undefined });
  } else if (expect === 'error') {
    checks.push({ label: 'Retourne une erreur', ok: errored && result.outcome !== 'network' });
    if (expectedCode) checks.push({ label: `Code d’erreur = ${expectedCode}`, ok: result.codes.includes(expectedCode) });
  }

  const status: RunRecord['status'] = expect === 'none' ? 'none' : checks.every((c) => c.ok) ? 'pass' : 'fail';
  let summary = result.title;
  if (status === 'fail') {
    if (expect === 'error' && !errored) summary = 'Succès : le serveur a accepté une valeur qui devait être refusée';
    else if (expect === 'success' && errored) summary = `Erreur : ${result.issues[0]?.message ?? result.title}`;
    else if (expectedCode) summary = `Erreur reçue avec le code ${result.codes.join(', ') || 'aucun'}`;
  }
  return {
    at: new Date().toISOString(),
    environment,
    status,
    httpStatus: result.httpStatus ?? 0,
    durationMs: result.durationMs ?? 0,
    summary,
    checks,
  };
}
