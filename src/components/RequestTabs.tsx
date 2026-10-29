import { useMemo, useState } from 'react';
import { buildDocument } from '../lib/graphql/document';
import { EXPECT_LABEL, edgeCasesFor } from '../lib/graphql/edgeCases';
import type { FieldSpec } from '../lib/graphql/fields';
import { allLeafPaths, type SelectionNode } from '../lib/graphql/selection';
import { prepareVariables } from '../lib/graphql/values';
import { edgeVerdict, runAllEdgeCases, runEdgeCase, setFormValues, setSelection, type OpContext } from '../state/actions';
import { formKey, useActive, useStore, type FormState } from '../state/store';
import { FieldInput, type ErrorLookup } from './FieldInput';
import { Icon, Spinner } from './Icon';

export function InputsTab({ ctx, form }: { ctx: OpContext; form: FormState }) {
  const { project } = useActive();
  const run = useStore((s) => s.runs[formKey(project.id, ctx.key)]);

  // Associe les erreurs du serveur aux champs du formulaire (chemin complet ou nom du champ).
  const errorFor = useMemo<ErrorLookup>(() => {
    const issues = run?.result && run.result.outcome !== 'success' ? run.result.issues.filter((i) => i.field) : [];
    const byPath = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const i of issues) {
      const f = i.field!.replace(/\[\d+\]/g, '').replace(/\.\d+(?=\.|$)/g, '');
      byPath.set(f, i.message);
      byName.set(f.split('.').pop()!, i.message);
    }
    return (spec: FieldSpec) => byPath.get(spec.path) ?? byPath.get(spec.path.split('.').slice(1).join('.')) ?? byName.get(spec.name);
  }, [run?.result]);

  if (!ctx.fields.length) {
    return (
      <div className="card-body">
        <p className="muted">Cette opération ne prend aucune donnée en entrée. Cliquez simplement sur Exécuter.</p>
      </div>
    );
  }

  return (
    <div className="card-body">
      <div className="form-grid">
        {ctx.fields.map((f) => (
          <FieldInput
            key={f.path}
            spec={f}
            value={form.values[f.name]}
            errorFor={errorFor}
            onChange={(v) => {
              const next = { ...form.values };
              if (v === undefined) delete next[f.name];
              else next[f.name] = v;
              setFormValues(ctx, next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SelectionGroup({ nodes, selected, toggle }: { nodes: SelectionNode[]; selected: Set<string>; toggle: (p: string) => void }) {
  const leaves = nodes.filter((n) => n.leaf);
  const groups = nodes.filter((n) => !n.leaf);
  return (
    <div className="sel-tree">
      {leaves.length > 0 && (
        <div className="row wrap">
          {leaves.map((n) => (
            <label key={n.path} className="chip-toggle" title={n.typeLabel}>
              <input type="checkbox" checked={selected.has(n.path)} onChange={() => toggle(n.path)} />
              <span className="mono">{n.name}</span>
            </label>
          ))}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.path} className="sel-group">
          <span className="label">
            {g.name} <span style={{ opacity: 0.7 }}>{g.typeLabel}</span>
          </span>
          <SelectionGroup nodes={g.children ?? []} selected={selected} toggle={toggle} />
        </div>
      ))}
    </div>
  );
}

export function OutputTab({ ctx, form }: { ctx: OpContext; form: FormState }) {
  const selection = form.selection ?? ctx.defaultSel;
  const selected = new Set(selection);
  if (!ctx.tree) {
    return (
      <div className="card-body">
        <p className="muted">Cette opération renvoie une simple valeur ({ctx.op.returnTypeLabel}) : rien à choisir.</p>
      </div>
    );
  }
  const toggle = (p: string) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setSelection(ctx, [...next]);
  };
  return (
    <div className="card-body stack" style={{ gap: 14 }}>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <p style={{ color: 'var(--text2)' }}>Choisissez les informations que le serveur doit renvoyer.</p>
        <div className="row">
          <button className="btn btn-sm" onClick={() => setSelection(ctx, ctx.defaultSel)}>
            Par défaut
          </button>
          <button className="btn btn-sm" onClick={() => setSelection(ctx, allLeafPaths(ctx.tree))}>
            Tout
          </button>
        </div>
      </div>
      <SelectionGroup nodes={ctx.tree} selected={selected} toggle={toggle} />
    </div>
  );
}

export function EdgesTab({ ctx }: { ctx: OpContext }) {
  const { project, env } = useActive();
  const fk = formKey(project.id, ctx.key);
  const runs = useStore((s) => s.edgeRuns[fk]);
  const [busy, setBusy] = useState(false);
  const hasAuth = Object.values(env.tokens).some((t) => t.trim()) && env.headers.some((h) => h.enabled && h.value.includes('{{token}}'));
  const cases = useMemo(() => edgeCasesFor(ctx.fields, { hasAuth, isMutation: ctx.op.kind === 'mutation' }), [ctx.fields, hasAuth, ctx.op.kind]);

  return (
    <div className="card-body stack" style={{ gap: 12 }}>
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
        <p style={{ color: 'var(--text2)', maxWidth: 480, lineHeight: 1.5 }}>
          Générés à partir des règles du schéma : les valeurs juste à côté des limites, là où les bogues se cachent. Chaque cas part des données du formulaire.
        </p>
        <button
          className="btn btn-sm"
          disabled={busy || !cases.length || (ctx.op.kind === 'mutation' && env.readOnly)}
          onClick={async () => {
            setBusy(true);
            await runAllEdgeCases(ctx, cases);
            setBusy(false);
          }}
        >
          {busy ? <Spinner size={14} /> : null}
          Tout lancer
        </button>
      </div>
      {ctx.op.kind === 'mutation' && (
        <div className={`notice ${env.readOnly ? 'err' : 'warn'}`}>
          <Icon name="alert" />
          {env.readOnly
            ? `« ${env.name} » est en lecture seule : les cas limites d’une mutation ne peuvent pas y être lancés.`
            : `Attention : sur une mutation, un cas accepté par le serveur crée ou modifie réellement des données dans « ${env.name} ».`}
        </div>
      )}
      {cases.length === 0 ? (
        <p className="muted">Aucun cas limite à proposer pour cette opération.</p>
      ) : (
        <div className="edge-list">
          {cases.map((ec) => {
            const r = runs?.[ec.id];
            const v = r?.result ? edgeVerdict(ec, r.result) : null;
            return (
              <div key={ec.id} className="edge">
                <Icon name="alert" size={18} style={{ color: 'var(--warn)', flex: 'none' }} />
                <div className="what">
                  <span className="mono">{ec.label.length > 80 ? `${ec.label.slice(0, 80)}…` : ec.label}</span>
                  <span className="detail">{ec.detail}</span>
                </div>
                {v ? (
                  <span className={`badge ${v.verdict === 'ok' ? 'ok' : v.verdict === 'warn' ? 'err' : ''}`} title={r?.result?.issues.map((i) => i.message).join('\n')}>
                    {v.verdict === 'ok' && <Icon name="check" size={12} strokeWidth={3} />}
                    {v.verdict === 'warn' && <Icon name="alert" size={12} strokeWidth={2.4} />}
                    {v.text}
                  </span>
                ) : (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    Attendu : <strong style={{ color: 'var(--text2)' }}>{EXPECT_LABEL[ec.expect]}</strong>
                  </span>
                )}
                <button className="btn btn-sm" disabled={r?.running || (ctx.op.kind === 'mutation' && env.readOnly)} onClick={() => runEdgeCase(ctx, ec)}>
                  {r?.running ? <Spinner size={14} /> : null}
                  {r?.result ? 'Relancer' : 'Essayer'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    useStore.getState().notify('Copié dans le presse-papiers.');
  } catch {
    useStore.getState().notify('Copie impossible.', 'error');
  }
}

export function GraphqlTab({ ctx, form }: { ctx: OpContext; form: FormState }) {
  const variables = prepareVariables(ctx.fields, form.values);
  const doc = buildDocument(ctx.op, ctx.tree, form.selection ?? ctx.defaultSel, variables);
  const vars = JSON.stringify(variables, null, 2);
  return (
    <div className="card-body stack" style={{ gap: 12 }}>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <span className="muted">Généré automatiquement depuis le formulaire, en lecture seule.</span>
        <div className="row">
          <button className="btn btn-sm" onClick={() => copy(doc)}>
            <Icon name="copy" size={14} /> Requête
          </button>
          <button className="btn btn-sm" onClick={() => copy(vars)}>
            <Icon name="copy" size={14} /> Variables
          </button>
        </div>
      </div>
      <pre className="code">{doc}</pre>
      <span className="section-label">Variables</span>
      <pre className="code">{vars}</pre>
    </div>
  );
}
