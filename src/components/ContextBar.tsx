import type { ReactNode } from 'react';
import { loadSchema } from '../state/actions';
import { useActive, useStore } from '../state/store';
import { Icon, Spinner } from './Icon';

export function SchemaBadge() {
  const { schema } = useActive();
  if (!schema || schema.status === 'idle') return <span className="badge">Schéma non chargé</span>;
  if (schema.status === 'loading')
    return (
      <span className="badge">
        <Spinner size={12} /> Lecture du schéma…
      </span>
    );
  if (schema.status === 'error')
    return (
      <span className="badge err" title={schema.error}>
        <Icon name="alert" size={12} strokeWidth={2.4} /> Schéma indisponible
      </span>
    );
  return (
    <span className="badge ok">
      <Icon name="check" size={12} strokeWidth={3} /> Schéma à jour · {schema.operations?.length ?? 0} opérations
    </span>
  );
}

/** Barre du haut : projet / environnement, état du schéma, rôle, et actions propres à l'écran. */
export function ContextBar({ children, showRole = true }: { children?: ReactNode; showRole?: boolean }) {
  const { project, env } = useActive();
  const projects = useStore((s) => s.data.projects);
  const updateData = useStore((s) => s.updateData);
  const updateProject = useStore((s) => s.updateProject);

  return (
    <header className="topbar">
      <div className="switcher">
        <label>
          <span className="sr">Projet</span>
          <select value={project.id} onChange={(e) => updateData((d) => ({ ...d, activeProjectId: e.target.value }))}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span className="sep" aria-hidden="true">
          /
        </span>
        <label className="row" style={{ gap: 2, paddingLeft: 8 }}>
          <span className="env-dot" style={{ background: env.color }} aria-hidden="true" />
          <span className="sr">Environnement</span>
          <select value={env.id} style={{ fontWeight: 600 }} onChange={(e) => updateProject((p) => ({ ...p, activeEnvironmentId: e.target.value }))}>
            {project.environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.readOnly ? ' (lecture seule)' : ''}
              </option>
            ))}
          </select>
        </label>
        <SchemaBadge />
        <button className="btn btn-plain btn-sm btn-icon" aria-label="Rescanner le schéma" title="Rescanner le schéma" onClick={() => loadSchema(true)}>
          <Icon name="refresh" />
        </button>
      </div>
      <div className="spacer" />
      <div className="row wrap" style={{ justifyContent: 'flex-end', gap: 10 }}>
        {showRole && project.roles.length > 0 && (
          <label className="row" style={{ gap: 8, fontSize: 13, color: 'var(--text3)', fontWeight: 500 }}>
            Rôle
            <select
              className="fld"
              style={{ width: 'auto', minWidth: 170, maxWidth: 260, height: 40, fontSize: 14, fontWeight: 600, paddingRight: 32 }}
              value={project.activeRoleId ?? ''}
              onChange={(e) => updateProject((p) => ({ ...p, activeRoleId: e.target.value || null }))}
            >
              {project.roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {env.tokens[r.id] ? '' : ' (sans jeton)'}
                </option>
              ))}
            </select>
          </label>
        )}
        {children}
      </div>
    </header>
  );
}
