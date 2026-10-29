import { useMemo } from 'react';
import { groupOperations } from '../lib/graphql/schema';
import { opKey, useActive, useStore } from '../state/store';
import { Icon, KindGlyph } from './Icon';

export function Explorer() {
  const { project, schema } = useActive();
  const selectedOp = useStore((s) => s.selectedOp);
  const kindFilter = useStore((s) => s.kindFilter);
  const search = useStore((s) => s.search);
  const collapsed = useStore((s) => s.collapsed);
  const set = useStore((s) => s.set);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ops = (schema?.operations ?? []).filter((o) => {
      if (kindFilter !== 'all' && o.kind !== kindFilter) return false;
      if (!q) return true;
      const groupName = (project.groupNames[o.group] ?? o.group).toLowerCase();
      return o.name.toLowerCase().includes(q) || (o.description ?? '').toLowerCase().includes(q) || groupName.includes(q);
    });
    return groupOperations(ops);
  }, [schema?.operations, kindFilter, search, project.groupNames]);

  const total = schema?.operations?.length ?? 0;

  return (
    <aside className="sidebar" aria-label="Opérations disponibles">
      <div className="side-title">
        <h2>Opérations</h2>
        <span className="mono muted" style={{ fontSize: 12 }}>
          {total}
        </span>
      </div>
      <label className="search">
        <span className="sr">Rechercher une opération</span>
        <Icon name="search" />
        <input className="fld" type="search" placeholder="Rechercher…" value={search} onChange={(e) => set({ search: e.target.value })} />
      </label>
      <div className="seg" role="tablist" aria-label="Type d'opération">
        {(
          [
            ['all', 'Tout'],
            ['query', 'Queries'],
            ['mutation', 'Mutations'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={kindFilter === k} onClick={() => set({ kindFilter: k })}>
            {label}
          </button>
        ))}
      </div>

      <div className="stack" style={{ gap: 14 }}>
        {groups.map((g) => {
          const open = !collapsed[g.key] || !!search.trim();
          return (
            <div key={g.key} className="stack" style={{ gap: 2 }}>
              <button className="group-head" aria-expanded={open} onClick={() => set({ collapsed: { ...collapsed, [g.key]: open } })}>
                <Icon name="chevron" size={12} strokeWidth={2.8} />
                <span className="name">{project.groupNames[g.key] || g.key}</span>
                <span className="mono" style={{ fontSize: 11 }}>
                  {g.operations.length}
                </span>
              </button>
              {open &&
                g.operations.map((o) => {
                  const key = opKey(o);
                  return (
                    <button
                      key={key}
                      className="op-btn"
                      aria-current={selectedOp === key ? 'true' : undefined}
                      onClick={() => set({ selectedOp: key, showSave: false, tab: 'inputs' })}
                    >
                      <KindGlyph kind={o.kind} />
                      <span className="stack" style={{ gap: 1, minWidth: 0 }}>
                        <span className={`op-name${o.deprecated ? ' deprecated' : ''}`}>{o.name}</span>
                        {o.description && <span className="op-desc">{o.description}</span>}
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}
        {schema?.status === 'ready' && groups.length === 0 && (
          <p className="muted" style={{ padding: '0 6px', fontSize: 13 }}>
            Aucune opération ne correspond.
          </p>
        )}
      </div>
      <p className="muted" style={{ marginTop: 'auto', padding: '0 4px', fontSize: 12, lineHeight: 1.5 }}>
        Groupes déduits automatiquement du schéma. Renommez-les dans Réglages › Projets.
      </p>
    </aside>
  );
}
