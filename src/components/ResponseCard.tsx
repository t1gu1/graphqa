import { toTable } from '../lib/graphql/errors';
import type { OpContext } from '../state/actions';
import { formKey, useActive, useStore } from '../state/store';
import { Icon, Play, Spinner } from './Icon';

function size(bytes: number | null): string {
  if (bytes == null) return '';
  return bytes < 1024 ? `${bytes} o` : `${(bytes / 1024).toFixed(1).replace('.', ',')} Ko`;
}

export function ResponseCard({ ctx }: { ctx: OpContext }) {
  const { project } = useActive();
  const run = useStore((s) => s.runs[formKey(project.id, ctx.key)]);
  const view = useStore((s) => s.responseView);
  const set = useStore((s) => s.set);
  const r = run?.result;
  const ok = r?.outcome === 'success';
  const hasFieldIssues = !!r?.issues.some((i) => i.field);

  let body;
  if (run?.blocked) {
    body = (
      <div className="card-body">
        <div className="notice err">
          <Icon name="lock" />
          {run.blocked}
        </div>
      </div>
    );
  } else if (run?.running && !r) {
    body = (
      <div className="empty">
        <Spinner size={22} />
        <span>Envoi de la requête…</span>
      </div>
    );
  } else if (!r) {
    body = (
      <div className="empty">
        <div className="icon">
          <Play size={20} />
        </div>
        <strong>Pas encore exécutée</strong>
        <span>Remplissez les données, puis cliquez sur Exécuter (ou Ctrl + Entrée).</span>
      </div>
    );
  } else if (view === 'json') {
    body = (
      <div style={{ padding: 16 }}>
        <pre className="code">{r.json !== undefined ? JSON.stringify(r.json, null, 2) : r.raw}</pre>
      </div>
    );
  } else if (!ok) {
    body = (
      <div className="card-body stack" style={{ gap: 14 }}>
        <div className="result-head">
          <div className="result-icon err" aria-hidden="true">
            <Icon name="x" size={18} strokeWidth={2.2} />
          </div>
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <span className="result-title">{r.title}</span>
            <span className="muted" style={{ fontSize: 13.5 }}>
              {r.subtitle}
              {r.codes.length > 0 && (
                <>
                  {' · '}
                  <span className="mono" style={{ fontSize: 12, color: 'var(--err)' }}>
                    {r.codes.join(', ')}
                  </span>
                </>
              )}
            </span>
          </div>
        </div>
        <div className="issues">
          {r.issues.map((i, n) => (
            <div key={n} className="issue">
              {i.field && <span className="field-tag">{i.field}</span>}
              <span className="msg">{i.message}</span>
              {i.original !== i.message && i.original.length < 300 && <span className="orig">{i.original}</span>}
            </div>
          ))}
        </div>
        {hasFieldIssues && (
          <button className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={() => set({ tab: 'inputs' })}>
            Voir les champs en erreur →
          </button>
        )}
        {r.learned.length > 0 && (
          <div className="notice">
            <Icon name="sparkle" />
            Règle apprise depuis cette erreur : elle s’affiche maintenant sous le champ et sert aux cas limites.
          </div>
        )}
      </div>
    );
  } else {
    const table = toTable(r.data);
    const single = r.data && typeof r.data === 'object' ? Object.values(r.data as Record<string, unknown>)[0] : undefined;
    body = (
      <div className="card-body stack" style={{ gap: 14 }}>
        <div className="result-head" style={{ alignItems: 'center' }}>
          <div className="result-icon ok" aria-hidden="true">
            <Icon name="check" size={18} strokeWidth={2.4} />
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="result-title">Succès</span>
            <span className="muted" style={{ fontSize: 13.5 }}>
              {r.subtitle}
            </span>
          </div>
        </div>
        {table ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td key={j} title={v}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          single !== undefined && typeof single !== 'object' && <pre className="code">{JSON.stringify(single)}</pre>
        )}
        {table?.truncated && <span className="muted">Affichage limité aux 200 premières lignes. Le JSON complet est dans l’onglet JSON.</span>}
      </div>
    );
  }

  return (
    <section className="card response" aria-label="Réponse" aria-busy={run?.running}>
      <div className="card-head">
        <h2>Réponse</h2>
        {run?.running && <Spinner size={14} />}
        {r && (
          <>
            <span className={`status-chip ${ok ? 'ok' : 'err'}`} title={r.httpStatus ? `HTTP ${r.httpStatus}` : undefined}>
              {ok ? r.httpStatus : (r.codes[0] ?? r.httpStatus ?? 'réseau')}
            </span>
            <span className="mono muted" style={{ fontSize: 12 }}>
              {r.durationMs != null ? `${r.durationMs} ms` : ''} {size(r.sizeBytes)}
            </span>
            <div className="spacer" />
            <div className="seg sm" role="tablist" aria-label="Affichage">
              <button role="tab" aria-selected={view === 'readable'} onClick={() => set({ responseView: 'readable' })}>
                Lisible
              </button>
              <button role="tab" aria-selected={view === 'json'} onClick={() => set({ responseView: 'json' })}>
                JSON
              </button>
            </div>
          </>
        )}
      </div>
      {body}
    </section>
  );
}
