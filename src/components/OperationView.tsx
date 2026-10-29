import { useEffect, useState } from 'react';
import { missingRequired } from '../lib/graphql/values';
import type { Expectation } from '../lib/types';
import { currentForm, fillExample, resetForm, runOperation, saveCurrentAsTest, type OpContext } from '../state/actions';
import { formKey, useActive, useStore, type RequestTab } from '../state/store';
import { Icon, Play, Spinner } from './Icon';
import { EdgesTab, GraphqlTab, InputsTab, OutputTab } from './RequestTabs';
import { ResponseCard } from './ResponseCard';

function SavePanel({ ctx }: { ctx: OpContext }) {
  const { project } = useActive();
  const run = useStore((s) => s.runs[formKey(project.id, ctx.key)]);
  const set = useStore((s) => s.set);
  const failed = !!run?.result && run.result.outcome !== 'success';
  const [name, setName] = useState(`${ctx.op.name} — ${failed ? 'erreur attendue' : 'cas nominal'}`);
  const [collectionId, setCollectionId] = useState(project.collections[0]?.id ?? '');
  const [expect, setExpect] = useState<Expectation | 'example'>(failed ? 'error' : 'success');

  return (
    <form
      className="save-panel"
      onSubmit={(e) => {
        e.preventDefault();
        saveCurrentAsTest(ctx, {
          name,
          collectionId,
          expect: expect === 'example' ? 'none' : expect,
          type: expect === 'example' ? 'example' : 'test',
        });
        set({ showSave: false });
      }}
    >
      <label className="stack-label">
        Nom
        <input className="fld" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="stack-label">
        Collection
        <select className="fld" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          {project.collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="stack-label">
        Résultat attendu
        <select className="fld" value={expect} onChange={(e) => setExpect(e.target.value as Expectation | 'example')}>
          <option value="success">Doit réussir</option>
          <option value="error">Doit échouer (erreur attendue{failed && run?.result?.codes[0] ? ` : ${run.result.codes[0]}` : ''})</option>
          <option value="example">Simple exemple (sans vérification)</option>
        </select>
      </label>
      <button type="submit" className="btn btn-dark" disabled={!collectionId}>
        Enregistrer dans la bibliothèque
      </button>
    </form>
  );
}

const TABS: { id: RequestTab; label: string }[] = [
  { id: 'inputs', label: 'Données' },
  { id: 'out', label: 'Champs reçus' },
  { id: 'edges', label: 'Cas limites' },
  { id: 'gql', label: 'GraphQL' },
];

export function OperationView({ ctx }: { ctx: OpContext }) {
  const { project, env } = useActive();
  const fk = formKey(project.id, ctx.key);
  const form = useStore((s) => s.forms[fk]) ?? currentForm(ctx, project.id);
  const running = useStore((s) => !!s.runs[fk]?.running);
  const tab = useStore((s) => s.tab);
  const showSave = useStore((s) => s.showSave);
  const set = useStore((s) => s.set);
  const groupName = project.groupNames[ctx.op.group] || ctx.op.group;
  const isMut = ctx.op.kind === 'mutation';
  const missing = missingRequired(ctx.fields, form.values);

  // Ctrl/Cmd + Entrée : exécuter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runOperation(ctx);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctx]);

  const counts: Record<RequestTab, string> = {
    inputs: String(ctx.fields.length),
    out: String((form.selection ?? ctx.defaultSel).length),
    edges: '',
    gql: '',
  };

  return (
    <>
      <div className="op-header">
        <div className="stack" style={{ gap: 8, minWidth: 0, maxWidth: 700 }}>
          <span className="crumb">
            {groupName} / {isMut ? 'Mutations' : 'Queries'}
          </span>
          <div className="row wrap" style={{ gap: 12 }}>
            <h1>{ctx.op.name}</h1>
            <span className={`badge ${isMut ? 'm' : 'q'}`} style={{ fontWeight: 700 }}>
              {isMut ? 'Mutation' : 'Query'}
            </span>
            {ctx.op.deprecated && <span className="badge warn">Obsolète</span>}
          </div>
          <p className="desc">
            {ctx.op.description ? `${ctx.op.description} ` : ''}
            <span className="muted">Retourne</span> <span className="type-chip">{ctx.op.returnTypeLabel}</span>
          </p>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={() => fillExample(ctx)} title="Remplit tous les champs avec des valeurs plausibles qui respectent les règles connues">
            <Icon name="wand" /> Exemple
          </button>
          <button className="btn btn-plain" onClick={() => resetForm(ctx)}>
            Vider
          </button>
          <button className="btn" aria-expanded={showSave} onClick={() => set({ showSave: !showSave })}>
            <Icon name="bookmark" /> Sauvegarder
          </button>
          <button className="btn btn-primary" style={{ paddingRight: 12 }} onClick={() => runOperation(ctx)} disabled={running}>
            {running ? <Spinner size={14} /> : <Play />}
            Exécuter
            <span className="kbd" aria-hidden="true">
              Ctrl ↵
            </span>
          </button>
        </div>
      </div>

      {isMut && env.readOnly && (
        <div className="notice err">
          <Icon name="lock" />« {env.name} » est en lecture seule : cette mutation ne sera pas envoyée.
        </div>
      )}
      {missing.length > 0 && (
        <div className="notice">
          <Icon name="info" />
          Champs obligatoires vides : {missing.join(', ')}. Vous pouvez quand même exécuter pour voir comment le serveur réagit.
        </div>
      )}
      {showSave && <SavePanel key={ctx.key} ctx={ctx} />}

      <div className="panels">
        <section className="card" aria-label="Requête">
          <div className="tabs" role="tablist" aria-label="Requête">
            {TABS.map((t) => (
              <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => set({ tab: t.id })}>
                {t.label}
                {counts[t.id] && <span className="count">{counts[t.id]}</span>}
              </button>
            ))}
          </div>
          {tab === 'inputs' && <InputsTab ctx={ctx} form={form} />}
          {tab === 'out' && <OutputTab ctx={ctx} form={form} />}
          {tab === 'edges' && <EdgesTab ctx={ctx} />}
          {tab === 'gql' && <GraphqlTab ctx={ctx} form={form} />}
        </section>
        <ResponseCard ctx={ctx} />
      </div>
    </>
  );
}
