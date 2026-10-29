import { useEffect, useMemo } from 'react';
import { AssistantPanel } from '../components/AssistantPanel';
import { ContextBar } from '../components/ContextBar';
import { Explorer } from '../components/Explorer';
import { Icon, Spinner } from '../components/Icon';
import { OperationView } from '../components/OperationView';
import { getOpContext, loadSchema } from '../state/actions';
import { useActive, useStore } from '../state/store';

export function Workbench() {
  const { project, env, schema } = useActive();
  const selectedOp = useStore((s) => s.selectedOp);
  const showAgent = useStore((s) => s.showAgent);
  const set = useStore((s) => s.set);

  useEffect(() => {
    loadSchema();
  }, [project.id, env.id, env.url, project.schemaSource, project.schemaSdl]);

  const ctx = useMemo(() => getOpContext(schema, selectedOp, project), [schema, selectedOp, project]);

  let content;
  if (!schema || (schema.status === 'loading' && !schema.operations)) {
    content = (
      <div className="card empty">
        <Spinner size={22} />
        <strong>Lecture du schéma de « {env.name} »…</strong>
        <span className="mono">{env.url}</span>
      </div>
    );
  } else if (schema.status === 'error') {
    content = (
      <div className="card empty">
        <div className="icon" style={{ background: 'var(--err-bg)', color: 'var(--err)' }}>
          <Icon name="alert" size={22} />
        </div>
        <strong>Impossible de lire le schéma</strong>
        <span>{schema.error}</span>
        <span className="mono" style={{ fontSize: 12.5 }}>
          {env.url}
        </span>
        <div className="row wrap" style={{ justifyContent: 'center', marginTop: 6 }}>
          <button className="btn btn-primary" onClick={() => loadSchema(true)}>
            Réessayer
          </button>
          <button className="btn" onClick={() => set({ screen: 'settings', settingsSection: 'projects' })}>
            Vérifier l’environnement
          </button>
        </div>
      </div>
    );
  } else if (!schema.operations?.length) {
    content = (
      <div className="card empty">
        <strong>Aucune opération dans ce schéma</strong>
        <span>Le serveur n’expose ni query ni mutation.</span>
      </div>
    );
  } else if (!ctx) {
    content = (
      <div className="card empty">
        <strong>Choisissez une opération</strong>
        <span>Sélectionnez une query ou une mutation dans la liste de gauche.</span>
      </div>
    );
  } else {
    content = <OperationView key={`${project.id}:${ctx.key}`} ctx={ctx} />;
  }

  return (
    <div className="screen">
      <ContextBar>
        <button
          className={`btn${showAgent ? '' : ''}`}
          style={showAgent ? { borderColor: 'var(--acc)', background: 'var(--acc-soft)', color: 'var(--acc-text)', height: 40 } : { height: 40 }}
          aria-pressed={showAgent}
          onClick={() => set({ showAgent: !showAgent })}
        >
          <Icon name="sparkle" strokeWidth={1.8} /> Assistant
        </button>
      </ContextBar>
      <div className="body">
        <Explorer />
        <main className="main">{content}</main>
        {showAgent && <AssistantPanel ctx={ctx} />}
      </div>
    </div>
  );
}
