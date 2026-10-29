import { buildSchema } from 'graphql';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmButton } from '../components/ConfirmButton';
import { Icon, Spinner } from '../components/Icon';
import { ENV_COLORS, newEnvironment, newProject, uid } from '../lib/defaults';
import type { Normalized } from '../lib/graphql/errors';
import { groupOperations } from '../lib/graphql/schema';
import { importTextFile, isTauri } from '../lib/platform';
import type { AgentId, Environment } from '../lib/types';
import { checkAgent, loadSchema, testConnection } from '../state/actions';
import { activeEnvironment, useActive, useStore, type SettingsSection } from '../state/store';

const SECTIONS: { id: SettingsSection; label: string; hint: string }[] = [
  { id: 'projects', label: 'Projets', hint: 'API, environnements, groupes' },
  { id: 'roles', label: 'Jetons et rôles', hint: 'Tester avec différents droits' },
  { id: 'agent', label: 'Assistant IA', hint: 'Claude CLI ou Copilot CLI' },
  { id: 'theme', label: 'Apparence', hint: 'Thème clair ou sombre' },
];

export function Settings() {
  const section = useStore((s) => s.settingsSection);
  const set = useStore((s) => s.set);
  return (
    <div className="screen">
      <div className="body">
        <nav className="settings-nav" aria-label="Sections des réglages">
          <h1>Réglages</h1>
          {SECTIONS.map((s) => (
            <button key={s.id} className="nav-item" aria-current={section === s.id ? 'page' : undefined} onClick={() => set({ settingsSection: s.id })}>
              <strong>{s.label}</strong>
              <span>{s.hint}</span>
            </button>
          ))}
        </nav>
        <main className="settings-main">
          <div className="settings-col">
            {section === 'projects' && <ProjectsSection />}
            {section === 'roles' && <RolesSection />}
            {section === 'agent' && <AgentSection />}
            {section === 'theme' && <ThemeSection />}
          </div>
        </main>
      </div>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="info">
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}

function SwitchRow({ title, hint, checked, onChange }: { title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="set-row">
      <span className="info">
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </span>
      <input className="switch" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

// ---------------------------------------------------------------------------

function ProjectsSection() {
  const { project, schema } = useActive();
  const projects = useStore((s) => s.data.projects);
  const updateData = useStore((s) => s.updateData);
  const updateProject = useStore((s) => s.updateProject);
  const notify = useStore((s) => s.notify);

  const groups = useMemo(() => groupOperations(schema?.operations ?? []), [schema?.operations]);
  useEffect(() => {
    loadSchema();
  }, [project.id]);

  const importSchemaFile = async () => {
    const sdl = await importTextFile(['graphql', 'gql', 'graphqls']);
    if (!sdl) return;
    try {
      const s = buildSchema(sdl);
      const count = Object.keys(s.getQueryType()?.getFields() ?? {}).length + Object.keys(s.getMutationType()?.getFields() ?? {}).length;
      updateProject((p) => ({ ...p, schemaSdl: sdl, schemaSource: 'file' }));
      notify(`Schéma importé : ${count} opérations.`);
    } catch (e) {
      notify(`Ce fichier n’est pas un schéma GraphQL valide : ${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  return (
    <>
      <div className="page-title">
        <h2>Projets</h2>
        <p>Un projet regroupe une API GraphQL, ses environnements et sa bibliothèque de tests.</p>
      </div>

      <div className="choice-grid">
        {projects.map((p) => (
          <button
            key={p.id}
            className="choice"
            aria-pressed={p.id === project.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 74 }}
            onClick={() => updateData((d) => ({ ...d, activeProjectId: p.id }))}
          >
            <span className="agent-avatar" style={{ width: 40, height: 40, borderRadius: 11, fontWeight: 700 }} aria-hidden="true">
              {p.name
                .split(/\s+/)
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span className="stack" style={{ gap: 2, minWidth: 0 }}>
              <strong style={{ fontSize: 15 }}>{p.name}</strong>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {p.environments.length} environnement{p.environments.length > 1 ? 's' : ''} · {p.tests.length} test{p.tests.length > 1 ? 's' : ''}
              </span>
            </span>
          </button>
        ))}
        <button
          className="choice"
          style={{ alignItems: 'center', justifyContent: 'center', flexDirection: 'row', borderStyle: 'dashed', minHeight: 74, color: 'var(--text2)', fontWeight: 600 }}
          onClick={() => {
            const p = newProject('Nouveau projet');
            p.activeRoleId = p.roles[0].id;
            updateData((d) => ({ ...d, projects: [...d.projects, p], activeProjectId: p.id }));
          }}
        >
          <Icon name="plus" /> Nouveau projet
        </button>
      </div>

      <section className="set-card" aria-label="Général">
        <header>
          <h3>Général</h3>
          {projects.length > 1 && (
            <ConfirmButton
              confirmLabel="Supprimer ce projet et ses tests ?"
              onConfirm={() =>
                updateData((d) => {
                  const rest = d.projects.filter((p) => p.id !== project.id);
                  return { ...d, projects: rest, activeProjectId: rest[0].id };
                })
              }
            >
              Supprimer le projet
            </ConfirmButton>
          )}
        </header>
        <Row title="Nom du projet" hint="Affiché dans la barre du haut.">
          <input className="fld" value={project.name} onChange={(e) => updateProject((p) => ({ ...p, name: e.target.value }))} />
        </Row>
        <Row title="Source du schéma" hint="D'où viennent les queries et mutations listées.">
          <select className="fld" value={project.schemaSource} onChange={(e) => updateProject((p) => ({ ...p, schemaSource: e.target.value as 'introspection' | 'file' }))}>
            <option value="introspection">Introspection de l'API (automatique)</option>
            <option value="file">Fichier de schéma (.graphql / .gql)</option>
          </select>
        </Row>
        {project.schemaSource === 'file' && (
          <Row title="Fichier de schéma" hint={project.schemaSdl ? `${Math.round(project.schemaSdl.length / 1024)} Ko importés. Les requêtes partent toujours vers l'environnement actif.` : 'Utile quand l’introspection est désactivée (souvent en production).'}>
            <button className="btn" onClick={importSchemaFile}>
              <Icon name="upload" /> {project.schemaSdl ? 'Remplacer le fichier' : 'Importer un fichier'}
            </button>
          </Row>
        )}
      </section>

      <section className="set-card" aria-label="Groupes d'opérations">
        <header>
          <div>
            <h3>Groupes d'opérations</h3>
            <p>Déduits automatiquement du schéma. Renommez-les pour l'équipe QA.</p>
          </div>
        </header>
        {groups.length === 0 ? (
          <div className="set-row">
            <span className="muted">Le schéma n'est pas encore chargé. Ouvrez l'Atelier pour le lire.</span>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="set-row">
              <span className="info">
                <strong className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                  {g.key}
                </strong>
                <span>
                  {g.operations.length} opération{g.operations.length > 1 ? 's' : ''}
                </span>
              </span>
              <label className="control">
                <span className="sr">Nom affiché pour {g.key}</span>
                <input
                  className="fld"
                  placeholder={g.key}
                  value={project.groupNames[g.key] ?? ''}
                  onChange={(e) => updateProject((p) => ({ ...p, groupNames: { ...p.groupNames, [g.key]: e.target.value } }))}
                />
              </label>
            </div>
          ))
        )}
      </section>

      <EnvironmentsCard />
    </>
  );
}

function EnvironmentsCard() {
  const { project } = useActive();
  const updateProject = useStore((s) => s.updateProject);
  const updateEnvironment = useStore((s) => s.updateEnvironment);
  const [envId, setEnvId] = useState(project.activeEnvironmentId);
  const env = project.environments.find((e) => e.id === envId) ?? activeEnvironment(project);
  const [test, setTest] = useState<{ running: boolean; result?: Normalized }>({ running: false });
  useEffect(() => setTest({ running: false }), [env.id, env.url]);

  const patch = (fn: (e: Environment) => Environment) => updateEnvironment(env.id, fn);

  return (
    <section className="set-card" aria-label="Environnements">
      <header>
        <div>
          <h3>Environnements</h3>
          <p>Où les requêtes sont envoyées. L'environnement actif se choisit dans la barre du haut.</p>
        </div>
        <button
          className="btn btn-sm"
          onClick={() => {
            const e = newEnvironment('Nouvel environnement', 'https://', ENV_COLORS[project.environments.length % ENV_COLORS.length]);
            updateProject((p) => ({ ...p, environments: [...p.environments, e] }));
            setEnvId(e.id);
          }}
        >
          <Icon name="plus" size={14} /> Ajouter
        </button>
      </header>

      <div className="pill-tabs" role="tablist" aria-label="Environnement à modifier">
        {project.environments.map((e) => (
          <button key={e.id} role="tab" aria-selected={e.id === env.id} onClick={() => setEnvId(e.id)}>
            <span className="env-dot" style={{ background: e.color }} aria-hidden="true" />
            {e.name || 'Sans nom'}
            {e.readOnly && <Icon name="lock" size={13} strokeWidth={2.2} aria-label="lecture seule" />}
            {e.id === project.activeEnvironmentId && <span className="sr">(actif)</span>}
          </button>
        ))}
      </div>

      <Row title="Nom">
        <input className="fld" value={env.name} onChange={(e) => patch((x) => ({ ...x, name: e.target.value }))} />
      </Row>
      <Row title="Adresse GraphQL" hint="L'URL complète du point d'accès.">
        <input className="fld mono" type="url" spellCheck={false} value={env.url} onChange={(e) => patch((x) => ({ ...x, url: e.target.value.trim() }))} />
      </Row>
      <Row title="Couleur" hint="Repère visuel dans la barre du haut.">
        <div className="row wrap" role="radiogroup" aria-label="Couleur">
          {ENV_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={env.color === c}
              aria-label={c}
              onClick={() => patch((x) => ({ ...x, color: c }))}
              style={{ width: 32, height: 32, borderRadius: 999, background: c, border: env.color === c ? '3px solid var(--text)' : '3px solid transparent' }}
            />
          ))}
        </div>
      </Row>
      <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <div className="info">
          <strong>En-têtes</strong>
          <span>
            Ajoutés à chaque requête. <span className="mono">{'{{token}}'}</span> est remplacé par le jeton du rôle choisi ; sans jeton, l'en-tête n'est pas envoyé.
          </span>
        </div>
        <div className="headers-grid">
          {env.headers.map((h) => (
            <HeaderRow key={h.id} env={env} id={h.id} />
          ))}
        </div>
        <button
          className="btn-link"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => patch((x) => ({ ...x, headers: [...x.headers, { id: uid('h-'), key: '', value: '', enabled: true }] }))}
        >
          + Ajouter un en-tête
        </button>
      </div>
      <SwitchRow
        title="Lecture seule"
        hint="Bloque toutes les mutations dans cet environnement. Recommandé pour la production."
        checked={env.readOnly}
        onChange={(v) => patch((x) => ({ ...x, readOnly: v }))}
      />
      <SwitchRow
        title="Accepter les certificats non vérifiés"
        hint="Pour un serveur local en HTTPS avec un certificat auto-signé. À laisser désactivé sinon."
        checked={env.insecureTls}
        onChange={(v) => patch((x) => ({ ...x, insecureTls: v }))}
      />
      <div className="set-row" style={{ background: 'var(--surface2)', gap: 14 }}>
        <button
          className="btn btn-primary"
          disabled={test.running}
          onClick={async () => {
            setTest({ running: true });
            setTest({ running: false, result: await testConnection(env, project.activeRoleId) });
          }}
        >
          {test.running && <Spinner size={14} />}
          Tester la connexion
        </button>
        {test.result &&
          (test.result.outcome === 'success' ? (
            <span className="badge ok">
              <Icon name="check" size={12} strokeWidth={3} /> Connecté · {test.result.durationMs} ms
            </span>
          ) : (
            <span className="badge err" title={test.result.issues[0]?.original}>
              <Icon name="alert" size={12} strokeWidth={2.4} /> {test.result.title}
            </span>
          ))}
        <div className="spacer" />
        {env.id !== project.activeEnvironmentId && (
          <button className="btn btn-sm" onClick={() => updateProject((p) => ({ ...p, activeEnvironmentId: env.id }))}>
            Utiliser cet environnement
          </button>
        )}
        {project.environments.length > 1 && (
          <ConfirmButton
            onConfirm={() => {
              updateProject((p) => {
                const rest = p.environments.filter((e) => e.id !== env.id);
                return { ...p, environments: rest, activeEnvironmentId: p.activeEnvironmentId === env.id ? rest[0].id : p.activeEnvironmentId };
              });
              setEnvId(project.environments.find((e) => e.id !== env.id)!.id);
            }}
          >
            Supprimer
          </ConfirmButton>
        )}
      </div>
    </section>
  );
}

function HeaderRow({ env, id }: { env: Environment; id: string }) {
  const updateEnvironment = useStore((s) => s.updateEnvironment);
  const h = env.headers.find((x) => x.id === id)!;
  const patch = (p: Partial<typeof h>) => updateEnvironment(env.id, (e) => ({ ...e, headers: e.headers.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  return (
    <>
      <input type="checkbox" aria-label={`Activer l'en-tête ${h.key}`} checked={h.enabled} onChange={(e) => patch({ enabled: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--acc)' }} />
      <input className="fld mono" aria-label="Nom de l'en-tête" placeholder="Nom" value={h.key} onChange={(e) => patch({ key: e.target.value })} />
      <input className="fld mono" aria-label="Valeur de l'en-tête" placeholder="Valeur" value={h.value} onChange={(e) => patch({ value: e.target.value })} />
      <button
        className="btn btn-plain btn-icon"
        aria-label={`Retirer l'en-tête ${h.key}`}
        onClick={() => updateEnvironment(env.id, (e) => ({ ...e, headers: e.headers.filter((x) => x.id !== id) }))}
      >
        <Icon name="x" />
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function RolesSection() {
  const { project } = useActive();
  const updateProject = useStore((s) => s.updateProject);
  const [reveal, setReveal] = useState(false);

  return (
    <>
      <div className="page-title">
        <h2>Jetons et rôles</h2>
        <p>Chaque rôle permet de tester ce qu'un type d'utilisateur a le droit de faire. Laissez un jeton vide pour tester sans authentification. Le rôle actif se choisit dans la barre du haut.</p>
      </div>
      <section className="set-card" aria-label="Jetons" style={{ overflowX: 'auto' }}>
        <header>
          <h3>Rôles</h3>
          <label className="row" style={{ gap: 8, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} style={{ accentColor: 'var(--acc)' }} />
            Afficher les jetons
          </label>
        </header>
        <table className="list" style={{ minWidth: 200 + project.environments.length * 220 }}>
          <thead>
            <tr>
              <th>Rôle</th>
              {project.environments.map((e) => (
                <th key={e.id}>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="env-dot" style={{ background: e.color }} /> {e.name}
                  </span>
                </th>
              ))}
              <th>
                <span className="sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {project.roles.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: '10px 18px' }}>
                  <label>
                    <span className="sr">Nom du rôle</span>
                    <input className="fld" style={{ fontWeight: 600 }} value={r.name} onChange={(e) => updateProject((p) => ({ ...p, roles: p.roles.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)) }))} />
                  </label>
                </td>
                {project.environments.map((e) => (
                  <td key={e.id} style={{ padding: '10px 18px' }}>
                    <label>
                      <span className="sr">
                        Jeton de {r.name} sur {e.name}
                      </span>
                      <input
                        className="fld mono"
                        type={reveal ? 'text' : 'password'}
                        placeholder="Aucun jeton"
                        autoComplete="off"
                        spellCheck={false}
                        value={e.tokens[r.id] ?? ''}
                        onChange={(ev) =>
                          updateProject((p) => ({
                            ...p,
                            environments: p.environments.map((x) => (x.id === e.id ? { ...x, tokens: { ...x.tokens, [r.id]: ev.target.value } } : x)),
                          }))
                        }
                      />
                    </label>
                  </td>
                ))}
                <td style={{ padding: '10px 18px', textAlign: 'right' }}>
                  {project.roles.length > 1 && (
                    <ConfirmButton
                      className="btn btn-plain btn-icon btn-danger"
                      ariaLabel={`Supprimer le rôle ${r.name}`}
                      confirmLabel="Supprimer ?"
                      onConfirm={() =>
                        updateProject((p) => ({
                          ...p,
                          roles: p.roles.filter((x) => x.id !== r.id),
                          activeRoleId: p.activeRoleId === r.id ? (p.roles.find((x) => x.id !== r.id)?.id ?? null) : p.activeRoleId,
                        }))
                      }
                    >
                      <Icon name="trash" />
                    </ConfirmButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <button className="btn" onClick={() => updateProject((p) => ({ ...p, roles: [...p.roles, { id: uid('r-'), name: 'Nouveau rôle' }] }))}>
          <Icon name="plus" /> Ajouter un rôle
        </button>
      </div>
      <div className="notice">
        <Icon name="lock" />
        Les jetons restent sur ce poste, dans le fichier de données de GraphQA. Ils ne sont jamais transmis à l'assistant IA ni inclus dans les exports de collections.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

const AGENTS: { id: AgentId; name: string; desc: string; install?: string; login?: string }[] = [
  {
    id: 'claude',
    name: 'Claude CLI',
    desc: 'Anthropic · commande claude',
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'Ouvrez un terminal, tapez « claude » et suivez la connexion à votre compte Anthropic. Fermez ensuite le terminal.',
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    desc: 'GitHub · commande copilot',
    install: 'npm install -g @github/copilot',
    login: 'Ouvrez un terminal, tapez « copilot » puis « /login » pour vous connecter avec votre compte GitHub.',
  },
  { id: 'none', name: 'Aucun', desc: 'Désactiver l’assistant' },
];

function AgentSection() {
  const settings = useStore((s) => s.data.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const status = useStore((s) => s.agentStatus);
  const notify = useStore((s) => s.notify);
  const agent = AGENTS.find((a) => a.id === settings.agent)!;
  const current = status.agent === settings.agent ? status.status : undefined;

  return (
    <>
      <div className="page-title">
        <h2>Assistant IA</h2>
        <p>Un seul assistant est actif à la fois. Il tourne sur ce poste, avec votre propre compte.</p>
      </div>
      <div className="choice-grid" role="radiogroup" aria-label="Assistant actif">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            className="choice"
            role="radio"
            aria-checked={settings.agent === a.id}
            onClick={() => {
              updateSettings({ agent: a.id });
              if (a.id !== 'none') checkAgent(a.id);
            }}
          >
            <span className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
              <strong style={{ fontSize: 15 }}>{a.name}</strong>
              <span className="radio" aria-hidden="true" />
            </span>
            <span className="muted" style={{ fontSize: 13 }}>
              {a.desc}
            </span>
          </button>
        ))}
      </div>

      {settings.agent !== 'none' && agent.install && (
        <>
          <section className="set-card" aria-label="Configuration guidée">
            <header>
              <h3>Configuration guidée — {agent.name}</h3>
            </header>
            <ol className="steps">
              <li className="step">
                <div className="rail-col">
                  <span className="num">1</span>
                  <span className="line" />
                </div>
                <div className="content">
                  <strong>Installer l'outil</strong>
                  <div className="cmd">
                    <code>{agent.install}</code>
                    <button onClick={() => navigator.clipboard.writeText(agent.install!).then(() => notify('Commande copiée.'))}>Copier</button>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Une seule fois, dans un terminal (Node.js requis). Un développeur peut le faire pour vous.
                  </span>
                </div>
              </li>
              <li className="step">
                <div className="rail-col">
                  <span className="num">2</span>
                  <span className="line" />
                </div>
                <div className="content">
                  <strong>Se connecter</strong>
                  <span style={{ color: 'var(--text2)', lineHeight: 1.55 }}>{agent.login}</span>
                </div>
              </li>
              <li className="step">
                <div className="rail-col">
                  <span className={`num${current?.found ? ' done' : ''}`}>3</span>
                </div>
                <div className="content" style={{ paddingBottom: 0 }}>
                  <strong>Laisser GraphQA le détecter</strong>
                  <div className="row wrap" style={{ gap: 12 }}>
                    <button className="btn btn-primary" disabled={status.checking || !isTauri()} onClick={() => checkAgent(settings.agent)}>
                      {status.checking && <Spinner size={14} />}
                      Détecter et tester
                    </button>
                    {current &&
                      (current.found ? (
                        <span className="badge ok">
                          <Icon name="check" size={12} strokeWidth={3} />
                          {current.version ?? agent.name} · actif
                        </span>
                      ) : (
                        <span className="badge err" style={{ whiteSpace: 'normal' }}>
                          <Icon name="alert" size={12} strokeWidth={2.4} />
                          {current.message ?? 'Introuvable'}
                        </span>
                      ))}
                  </div>
                  {current?.path && (
                    <span className="mono muted" style={{ fontSize: 12 }}>
                      {current.path}
                    </span>
                  )}
                </div>
              </li>
            </ol>
          </section>

          <section className="set-card" aria-label="Ce que l'assistant peut voir">
            <header>
              <h3>Ce que l'assistant peut voir</h3>
            </header>
            <SwitchRow
              title="Le schéma GraphQL du projet"
              hint="Les types utilisés par l'opération en cours."
              checked={settings.agentContext.schema}
              onChange={(v) => updateSettings({ agentContext: { ...settings.agentContext, schema: v } })}
            />
            <SwitchRow
              title="La requête et la réponse en cours"
              hint="Les données envoyées et la réponse du serveur."
              checked={settings.agentContext.request}
              onChange={(v) => updateSettings({ agentContext: { ...settings.agentContext, request: v } })}
            />
            <SwitchRow
              title="Les tests de la bibliothèque"
              hint="Les noms et résultats des tests de la même opération."
              checked={settings.agentContext.library}
              onChange={(v) => updateSettings({ agentContext: { ...settings.agentContext, library: v } })}
            />
            <div className="set-row" style={{ background: 'var(--surface2)' }}>
              <span className="row" style={{ gap: 12, alignItems: 'flex-start', color: 'var(--text2)', lineHeight: 1.5 }}>
                <Icon name="lock" style={{ flex: 'none', marginTop: 3 }} />
                Les jetons et les en-têtes d'authentification ne sont jamais transmis à l'assistant.
              </span>
            </div>
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function ThemeSection() {
  const theme = useStore((s) => s.data.settings.theme);
  const updateSettings = useStore((s) => s.updateSettings);
  const themes = [
    { id: 'light' as const, name: 'Clair', bg: '#F5F5F7', rail: '#FBFBFC', card: '#FFFFFF', bd: '#E4E4E9', acc: '#5B5BD6' },
    { id: 'dark' as const, name: 'Sombre', bg: '#0C0D10', rail: '#101115', card: '#141519', bd: '#24262D', acc: '#6363E0' },
  ];
  return (
    <>
      <div className="page-title">
        <h2>Apparence</h2>
        <p>Le thème s'applique à tout GraphQA, pour vous seulement.</p>
      </div>
      <div className="choice-grid" role="radiogroup" aria-label="Thème">
        {themes.map((t) => (
          <button key={t.id} className="choice" role="radio" aria-checked={theme === t.id} style={{ padding: 14, gap: 14 }} onClick={() => updateSettings({ theme: t.id })}>
            <span className="theme-preview" aria-hidden="true" style={{ background: t.bg, border: `1px solid ${t.bd}` }}>
              <span style={{ width: 18, borderRadius: 5, background: t.rail, border: `1px solid ${t.bd}`, boxShadow: `inset 0 14px 0 -6px ${t.acc}` }} />
              <span className="stack" style={{ flex: 1, gap: 6 }}>
                <span style={{ height: 14, borderRadius: 4, background: t.card, border: `1px solid ${t.bd}` }} />
                <span className="row" style={{ flex: 1, gap: 6, alignItems: 'stretch' }}>
                  <span style={{ flex: 1, borderRadius: 6, background: t.card, border: `1px solid ${t.bd}` }} />
                  <span style={{ flex: 1, borderRadius: 6, background: t.card, border: `1px solid ${t.bd}` }} />
                </span>
              </span>
            </span>
            <span className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
              <strong style={{ fontSize: 15 }}>{t.name}</strong>
              <span className="radio" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
