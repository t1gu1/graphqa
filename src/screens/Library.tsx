import { useMemo, useState } from 'react';
import { ConfirmButton } from '../components/ConfirmButton';
import { ContextBar } from '../components/ContextBar';
import { Icon, KindGlyph, Play, Spinner } from '../components/Icon';
import { uid } from '../lib/defaults';
import { exportTextFile, importTextFile } from '../lib/platform';
import type { Collection, Expectation, SavedTest } from '../lib/types';
import { openTestInWorkbench, runTests } from '../state/actions';
import { useActive, useStore } from '../state/store';

type Status = 'pass' | 'fail' | 'none' | 'never';

function statusOf(t: SavedTest): Status {
  if (t.type === 'example') return 'none';
  return t.lastRun ? t.lastRun.status : 'never';
}

const STATUS_LABEL: Record<Status, string> = { pass: 'Conforme', fail: 'Non conforme', none: 'Exemple', never: 'Pas encore lancé' };
const STATUS_CLASS: Record<Status, string> = { pass: 'ok', fail: 'err', none: '', never: '' };
const DOT: Record<Status, string> = { pass: 'var(--ok-solid)', fail: 'var(--err-solid)', none: 'var(--border2)', never: 'var(--border2)' };
const EXPECT_LABEL: Record<Expectation, string> = { success: 'Doit réussir', error: 'Doit échouer', none: '—' };

function flatten(value: unknown, prefix = ''): [string, string][] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return prefix ? [[prefix, '{}']] : [];
    return entries.flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return [[prefix, text.length > 120 ? `${text.slice(0, 120)}…` : text]];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

interface ExportFile {
  format: 'graphqa-collection';
  version: 1;
  collections: { name: string; tests: Omit<SavedTest, 'id' | 'collectionId' | 'lastRun'>[] }[];
}

export function Library() {
  const { project } = useActive();
  const view = useStore((s) => s.library);
  const running = useStore((s) => s.libraryRunning);
  const set = useStore((s) => s.set);
  const updateProject = useStore((s) => s.updateProject);
  const notify = useStore((s) => s.notify);
  const [newName, setNewName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const setView = (patch: Partial<typeof view>) => set({ library: { ...view, ...patch } });

  const inCollection = useMemo(
    () => project.tests.filter((t) => view.collectionId === 'all' || t.collectionId === view.collectionId),
    [project.tests, view.collectionId],
  );
  const visible = inCollection.filter((t) => {
    const s = statusOf(t);
    if (view.filter === 'fail' && s !== 'fail') return false;
    if (view.filter === 'pass' && s !== 'pass') return false;
    if (view.filter === 'example' && t.type !== 'example') return false;
    const q = view.search.trim().toLowerCase();
    return !q || t.name.toLowerCase().includes(q) || t.operation.toLowerCase().includes(q);
  });
  const selected = project.tests.find((t) => t.id === view.testId) ?? visible[0] ?? null;
  const tests = inCollection.filter((t) => t.type === 'test');
  const nPass = tests.filter((t) => statusOf(t) === 'pass').length;
  const nFail = tests.filter((t) => statusOf(t) === 'fail').length;
  const lastRun = inCollection
    .map((t) => t.lastRun)
    .filter((r): r is NonNullable<SavedTest['lastRun']> => !!r)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const collection = project.collections.find((c) => c.id === view.collectionId);

  const updateTest = (id: string, patch: Partial<SavedTest>) =>
    updateProject((p) => ({ ...p, tests: p.tests.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  const addCollection = (name: string) => {
    const c: Collection = { id: uid('c-'), name };
    updateProject((p) => ({ ...p, collections: [...p.collections, c] }));
    setView({ collectionId: c.id, testId: null });
  };

  const exportCollection = async () => {
    const cols = collection ? [collection] : project.collections;
    const file: ExportFile = {
      format: 'graphqa-collection',
      version: 1,
      collections: cols.map((c) => ({
        name: c.name,
        tests: project.tests.filter((t) => t.collectionId === c.id).map(({ id, collectionId, lastRun, ...rest }) => rest),
      })),
    };
    const slug = (collection?.name ?? project.name).toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
    if (await exportTextFile(`${slug || 'collection'}.graphqa.json`, JSON.stringify(file, null, 2))) notify('Collection exportée.');
  };

  const importCollection = async () => {
    const text = await importTextFile(['json']);
    if (!text) return;
    try {
      const file = JSON.parse(text) as ExportFile;
      if (file.format !== 'graphqa-collection' || !Array.isArray(file.collections)) throw new Error('format');
      let count = 0;
      updateProject((p) => {
        const collections = [...p.collections];
        const added: SavedTest[] = [];
        for (const c of file.collections) {
          const existing = collections.find((x) => x.name === c.name);
          const target = existing ?? { id: uid('c-'), name: c.name };
          if (!existing) collections.push(target);
          for (const t of c.tests) {
            added.push({ ...t, id: uid('t-'), collectionId: target.id, roleId: p.roles.some((r) => r.id === t.roleId) ? t.roleId : null });
            count++;
          }
        }
        return { ...p, collections, tests: [...p.tests, ...added] };
      });
      notify(`${count} élément${count > 1 ? 's' : ''} importé${count > 1 ? 's' : ''}.`);
    } catch {
      notify('Ce fichier n’est pas une collection GraphQA.', 'error');
    }
  };

  const status = selected ? statusOf(selected) : 'never';

  return (
    <div className="screen">
      <ContextBar showRole={false}>
        <label className="search" style={{ width: 280, maxWidth: '100%' }}>
          <span className="sr">Rechercher un test</span>
          <Icon name="search" />
          <input className="fld" style={{ height: 40, fontSize: 14 }} type="search" placeholder="Rechercher un test…" value={view.search} onChange={(e) => setView({ search: e.target.value })} />
        </label>
      </ContextBar>
      <div className="body">
        <aside className="sidebar" aria-label="Collections" style={{ gap: 4 }}>
          <div className="side-title" style={{ paddingBottom: 10, justifyContent: 'space-between' }}>
            <h2>Collections</h2>
            <button className="btn btn-plain btn-sm btn-icon" aria-label="Nouvelle collection" onClick={() => setNewName('')}>
              <Icon name="plus" />
            </button>
          </div>
          {[{ id: 'all', name: 'Tous les éléments' } as Collection, ...project.collections].map((c) => {
            const items = project.tests.filter((t) => c.id === 'all' || t.collectionId === c.id);
            const fails = items.filter((t) => statusOf(t) === 'fail').length;
            return (
              <button key={c.id} className="coll-btn" aria-current={view.collectionId === c.id ? 'true' : undefined} onClick={() => setView({ collectionId: c.id, testId: null, filter: 'all' })}>
                <Icon name="folder" strokeWidth={1.8} />
                <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
                {fails > 0 && (
                  <span className="badge err" style={{ padding: '1px 6px', fontSize: 11 }} aria-label={`${fails} non conforme(s)`}>
                    {fails}
                  </span>
                )}
                <span className="mono muted" style={{ fontSize: 11.5 }}>
                  {items.length}
                </span>
              </button>
            );
          })}
          {newName !== null && (
            <form
              className="row"
              style={{ padding: '4px 0' }}
              onSubmit={(e) => {
                e.preventDefault();
                if (newName.trim()) addCollection(newName.trim());
                setNewName(null);
              }}
            >
              <input className="fld" autoFocus placeholder="Nom de la collection" value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={() => !newName.trim() && setNewName(null)} />
            </form>
          )}
          <div className="stack" style={{ marginTop: 'auto', gap: 10, padding: 14, borderRadius: 12, background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            <strong style={{ fontSize: 13.5 }}>Partager avec l'équipe</strong>
            <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Les collections s'exportent en fichier versionnable, à garder dans le dépôt du back-end.
            </span>
            <div className="row">
              <button className="btn btn-sm" style={{ flex: 1 }} onClick={exportCollection}>
                <Icon name="download" size={14} /> Exporter
              </button>
              <button className="btn btn-sm" style={{ flex: 1 }} onClick={importCollection}>
                <Icon name="upload" size={14} /> Importer
              </button>
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="op-header">
            <div className="stack" style={{ gap: 6, minWidth: 0 }}>
              {renaming !== null && collection ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = renaming.trim();
                    if (name) updateProject((p) => ({ ...p, collections: p.collections.map((c) => (c.id === collection.id ? { ...c, name } : c)) }));
                    setRenaming(null);
                  }}
                >
                  <label className="sr" htmlFor="rename-collection">
                    Nom de la collection
                  </label>
                  <input id="rename-collection" className="fld" style={{ fontSize: 22, fontWeight: 700, height: 48 }} autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onBlur={(e) => e.currentTarget.form?.requestSubmit()} />
                </form>
              ) : (
                <h1 style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, letterSpacing: '-0.025em' }}>{collection?.name ?? 'Tous les éléments'}</h1>
              )}
              <p className="muted">{lastRun ? `Dernière exécution : ${formatDate(lastRun.at)}, sur ${lastRun.environment}.` : 'Pas encore exécutée.'}</p>
            </div>
            <div className="row wrap">
              {collection && renaming === null && (
                <button className="btn btn-plain btn-sm" onClick={() => setRenaming(collection.name)}>
                  Renommer
                </button>
              )}
              {collection && project.collections.length > 1 && (
                <ConfirmButton
                  confirmLabel={`Supprimer avec ses ${inCollection.length} élément(s) ?`}
                  onConfirm={() => {
                    updateProject((p) => ({ ...p, collections: p.collections.filter((c) => c.id !== collection.id), tests: p.tests.filter((t) => t.collectionId !== collection.id) }));
                    setView({ collectionId: 'all', testId: null });
                  }}
                >
                  Supprimer
                </ConfirmButton>
              )}
              <button className="btn btn-primary" disabled={running || !tests.length} onClick={() => runTests(tests.map((t) => t.id))}>
                {running ? <Spinner size={14} /> : <Play />}
                {running ? 'Exécution…' : 'Lancer la collection'}
              </button>
            </div>
          </div>

          <section className="card card-body stack" aria-label="Résumé" style={{ gap: 16 }}>
            <div className="stats">
              <div className="stat">
                <span className="k">Tests</span>
                <span className="v">{tests.length}</span>
              </div>
              <div className="stat">
                <span className="k">
                  <span className="dot" style={{ background: 'var(--ok-solid)' }} /> Conformes
                </span>
                <span className="v" style={{ color: 'var(--ok)' }}>
                  {nPass}
                </span>
              </div>
              <div className="stat">
                <span className="k">
                  <span className="dot" style={{ background: 'var(--err-solid)' }} /> Non conformes
                </span>
                <span className="v" style={{ color: 'var(--err)' }}>
                  {nFail}
                </span>
              </div>
              <div className="stat">
                <span className="k">Exemples</span>
                <span className="v">{inCollection.filter((t) => t.type === 'example').length}</span>
              </div>
            </div>
            {nPass + nFail > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="bar" role="img" aria-label={`${nPass} conforme(s) sur ${nPass + nFail}`}>
                  <span style={{ flex: `${nPass} 1 0`, background: 'var(--ok-solid)' }} />
                  {nFail > 0 && <span style={{ flex: `${nFail} 1 0`, minWidth: 8, background: 'var(--err-solid)' }} />}
                </div>
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {nPass} test{nPass > 1 ? 's' : ''} conforme{nPass > 1 ? 's' : ''} sur {nPass + nFail} ({Math.round((nPass * 100) / (nPass + nFail))} %)
                </span>
              </div>
            )}
          </section>

          <div className="filters" role="tablist" aria-label="Filtrer">
            {(
              [
                ['all', 'Tous'],
                ['fail', 'Non conformes'],
                ['pass', 'Conformes'],
                ['example', 'Exemples'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view.filter === k} onClick={() => setView({ filter: k })}>
                {label}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="card empty">
              <div className="icon">
                <Icon name="layers" size={20} />
              </div>
              <strong>{project.tests.length ? 'Rien à afficher ici' : 'La bibliothèque est vide'}</strong>
              <span>
                {project.tests.length
                  ? 'Changez de filtre ou de collection.'
                  : 'Dans l’Atelier, exécutez une opération puis cliquez sur Sauvegarder pour en faire un exemple ou un test.'}
              </span>
            </div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="list">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Opération</th>
                    <th>Attendu</th>
                    <th>Résultat</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => {
                    const s = statusOf(t);
                    return (
                      <tr key={t.id} aria-selected={selected?.id === t.id}>
                        <td>
                          <button className="row-btn" onClick={() => setView({ testId: t.id })}>
                            <span className="dot" style={{ background: DOT[s] }} aria-hidden="true" />
                            {t.name}
                          </button>
                        </td>
                        <td>
                          <span className="row">
                            <KindGlyph kind={t.kind} small />
                            <span className="mono" style={{ fontSize: 13, color: 'var(--text2)' }}>
                              {t.operation}
                            </span>
                          </span>
                        </td>
                        <td style={{ fontSize: 13.5, color: 'var(--text2)' }}>{EXPECT_LABEL[t.expect]}</td>
                        <td>
                          <span className={`badge ${STATUS_CLASS[s]}`}>{STATUS_LABEL[s]}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {selected && (
          <aside className="aside" aria-label="Détail" style={{ padding: '24px 20px', gap: 22, overflowY: 'auto' }}>
            <div className="stack" style={{ gap: 10 }}>
              <span className={`badge ${STATUS_CLASS[status]}`} style={{ alignSelf: 'flex-start', fontWeight: 700 }}>
                {STATUS_LABEL[status]}
              </span>
              <h2 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.01em' }}>{selected.name}</h2>
              <span className="row wrap">
                <KindGlyph kind={selected.kind} small />
                <span className="mono" style={{ fontSize: 13, color: 'var(--text2)' }}>
                  {selected.operation}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>
                  · {project.collections.find((c) => c.id === selected.collectionId)?.name}
                </span>
              </span>
            </div>

            {selected.lastRun && status === 'fail' && (
              <div className="stack" style={{ gap: 12, padding: 16, borderRadius: 14, background: 'var(--err-bg)', border: '1px solid var(--err-bd)' }}>
                <span className="row" style={{ fontWeight: 700, color: 'var(--err)' }}>
                  <Icon name="alert" strokeWidth={2.2} /> Écart détecté
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, fontSize: 13.5, lineHeight: 1.4 }}>
                  <div className="stack" style={{ gap: 3 }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Attendu
                    </span>
                    <strong>
                      {EXPECT_LABEL[selected.expect]}
                      {selected.expectedErrorCode ? ` (${selected.expectedErrorCode})` : ''}
                    </strong>
                  </div>
                  <div className="stack" style={{ gap: 3 }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Obtenu
                    </span>
                    <strong style={{ color: 'var(--err)' }}>{selected.lastRun.summary}</strong>
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => {
                    openTestInWorkbench(selected.id);
                    set({ showAgent: true });
                  }}
                >
                  <Icon name="sparkle" size={14} /> Analyser avec l'assistant
                </button>
              </div>
            )}
            {selected.lastRun && status !== 'fail' && (
              <p className="muted" style={{ fontSize: 13 }}>
                {selected.lastRun.summary} · {formatDate(selected.lastRun.at)} sur {selected.lastRun.environment}
              </p>
            )}

            <div className="stack" style={{ gap: 10 }}>
              <span className="section-label">Données envoyées</span>
              {flatten(selected.variables).length ? (
                <div className="kv">
                  {flatten(selected.variables).map(([k, v]) => (
                    <div key={k}>
                      <span className="k">{k}</span>
                      <span className="v">{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="muted">Aucune donnée.</span>
              )}
            </div>

            {selected.type === 'test' && (
              <div className="stack" style={{ gap: 10 }}>
                <span className="section-label">Vérifications</span>
                {selected.lastRun?.checks.length ? (
                  selected.lastRun.checks.map((c, i) => (
                    <div key={i} className="check">
                      <span className={`box ${c.ok ? 'ok' : 'ko'}`} role="img" aria-label={c.ok ? 'Conforme' : 'Non conforme'}>
                        <Icon name={c.ok ? 'check' : 'x'} size={12} strokeWidth={3} />
                      </span>
                      {c.label}
                    </div>
                  ))
                ) : (
                  <div className="check">
                    <span className="box na" />
                    Lancez le test pour voir les vérifications.
                  </div>
                )}
              </div>
            )}

            <div className="stack" style={{ gap: 10 }}>
              <span className="section-label">Réglages du test</span>
              <label className="stack-label">
                Résultat attendu
                <select
                  className="fld"
                  value={selected.type === 'example' ? 'example' : selected.expect}
                  onChange={(e) => {
                    const v = e.target.value as Expectation | 'example';
                    updateTest(selected.id, v === 'example' ? { type: 'example', expect: 'none', lastRun: undefined } : { type: 'test', expect: v, lastRun: undefined });
                  }}
                >
                  <option value="success">Doit réussir</option>
                  <option value="error">Doit échouer</option>
                  <option value="example">Simple exemple</option>
                </select>
              </label>
              {selected.expect === 'error' && (
                <label className="stack-label">
                  Code d’erreur attendu (facultatif)
                  <input
                    className="fld mono"
                    placeholder="ex. BAD_USER_INPUT"
                    value={selected.expectedErrorCode ?? ''}
                    onChange={(e) => updateTest(selected.id, { expectedErrorCode: e.target.value.trim() || undefined })}
                  />
                </label>
              )}
              <label className="stack-label">
                Collection
                <select className="fld" value={selected.collectionId} onChange={(e) => updateTest(selected.id, { collectionId: e.target.value })}>
                  {project.collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="row wrap" style={{ marginTop: 'auto' }}>
              <button className="btn btn-dark" style={{ flex: '1 1 160px' }} onClick={() => openTestInWorkbench(selected.id)}>
                Ouvrir dans l'atelier
              </button>
              {selected.type === 'test' && (
                <button className="btn" style={{ flex: '1 1 100px' }} disabled={running} onClick={() => runTests([selected.id])}>
                  <Play size={12} /> Lancer
                </button>
              )}
              <ConfirmButton
                className="btn btn-plain btn-icon btn-danger"
                ariaLabel="Supprimer"
                confirmLabel="Supprimer ?"
                onConfirm={() => {
                  updateProject((p) => ({ ...p, tests: p.tests.filter((t) => t.id !== selected.id) }));
                  setView({ testId: null });
                }}
              >
                <Icon name="trash" />
              </ConfirmButton>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
