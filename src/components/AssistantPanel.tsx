import { useEffect, useRef, useState } from 'react';
import { INTENT_LABEL, type AgentIntent } from '../lib/agent/prompt';
import type { AgentId } from '../lib/types';
import { addProposedTests, applyProposal, askAssistant, checkAgent, type OpContext } from '../state/actions';
import { useStore, type ChatMessage } from '../state/store';
import { Icon, Spinner } from './Icon';

const AGENT_NAMES: Record<Exclude<AgentId, 'none'>, string> = { claude: 'Claude CLI', copilot: 'Copilot CLI' };

function Setup() {
  const updateSettings = useStore((s) => s.updateSettings);
  const set = useStore((s) => s.set);
  const pick = (agent: Exclude<AgentId, 'none'>) => {
    updateSettings({ agent });
    checkAgent(agent);
  };
  return (
    <div className="stack" style={{ padding: '24px 18px', gap: 16 }}>
      <div className="agent-avatar" style={{ width: 48, height: 48, borderRadius: 14 }}>
        <Icon name="sparkle" size={24} strokeWidth={1.7} />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <strong style={{ fontSize: 18, letterSpacing: '-0.01em' }}>Activer un assistant</strong>
        <span style={{ color: 'var(--text2)', lineHeight: 1.55 }}>Un seul assistant est actif à la fois. Il tourne sur ce poste, avec votre propre compte.</span>
      </div>
      {(['claude', 'copilot'] as const).map((a) => (
        <button key={a} className="btn" style={{ height: 'auto', padding: 14, justifyContent: 'flex-start', textAlign: 'left', borderRadius: 12 }} onClick={() => pick(a)}>
          <span className="stack" style={{ gap: 3, flex: 1 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{AGENT_NAMES[a]}</span>
            <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
              {a === 'claude' ? 'Anthropic' : 'GitHub'} · commande <span className="mono">{a}</span>
            </span>
          </span>
          <Icon name="chevron" />
        </button>
      ))}
      <button className="btn-link" style={{ alignSelf: 'flex-start' }} onClick={() => set({ screen: 'settings', settingsSection: 'agent' })}>
        Pas encore installé ? Configuration guidée →
      </button>
    </div>
  );
}

function Message({ m, ctx }: { m: ChatMessage; ctx: OpContext | null }) {
  const agent = useStore((s) => s.data.settings.agent);
  const notify = useStore((s) => s.notify);
  if (m.role === 'user') return <div className="bubble-user">{m.text}</div>;
  const sameOp = ctx && m.operation === ctx.op.name;
  return (
    <div className={`msg-ai${m.role === 'error' ? ' error' : ''}`}>
      <span className="who">{m.role === 'error' ? 'Erreur' : agent !== 'none' ? AGENT_NAMES[agent] : 'Assistant'}</span>
      {m.text && <div className="text">{m.text}</div>}
      {m.role === 'assistant' && m.text.length > 200 && (
        <button
          className="btn-link"
          style={{ alignSelf: 'flex-start', fontSize: 12.5 }}
          onClick={() => navigator.clipboard.writeText(m.text).then(() => notify('Réponse copiée.'))}
        >
          Copier la réponse
        </button>
      )}
      {m.proposal?.variables && (
        <div className="proposal">
          <span className="title">Valeurs proposées</span>
          <pre className="code" style={{ padding: 12, maxHeight: 220 }}>
            {JSON.stringify(m.proposal.variables, null, 2)}
          </pre>
          {sameOp ? (
            <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => applyProposal(ctx!, m.proposal!.variables!)}>
              Appliquer et relancer
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Proposé pour {m.operation}.
            </span>
          )}
        </div>
      )}
      {m.proposal?.tests && m.proposal.tests.length > 0 && (
        <div className="proposal">
          <span className="title">Cas de test proposés</span>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13.5 }}>
            {m.proposal.tests.map((t, i) => (
              <li key={i}>
                {t.name} <span className="muted">— {t.expect === 'error' ? 'doit échouer' : 'doit réussir'}</span>
              </li>
            ))}
          </ul>
          {sameOp && (
            <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => addProposedTests(ctx!, m.proposal!.tests!)}>
              Ajouter {m.proposal.tests.length} tests à la bibliothèque
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AssistantPanel({ ctx }: { ctx: OpContext | null }) {
  const agent = useStore((s) => s.data.settings.agent);
  const ctxSettings = useStore((s) => s.data.settings.agentContext);
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.chatBusy);
  const status = useStore((s) => s.agentStatus);
  const set = useStore((s) => s.set);
  const updateSettings = useStore((s) => s.updateSettings);
  const [question, setQuestion] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (agent !== 'none' && status.agent !== agent && !status.checking) checkAgent(agent);
  }, [agent, status.agent, status.checking]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, busy]);

  const close = (
    <button className="btn btn-plain btn-sm btn-icon" aria-label="Masquer l'assistant" onClick={() => set({ showAgent: false })}>
      <Icon name="x" />
    </button>
  );

  if (agent === 'none') {
    return (
      <aside className="aside" aria-label="Assistant IA">
        <div className="agent-head">
          <strong style={{ flex: 1, fontSize: 14.5 }}>Assistant IA</strong>
          {close}
        </div>
        <Setup />
      </aside>
    );
  }

  const found = status.agent === agent && status.status?.found;
  const ask = (intent: AgentIntent, q?: string) => askAssistant(intent, q, ctx);
  const seen = [ctxSettings.schema && 'schéma', ctxSettings.request && 'requête et réponse', ctxSettings.library && 'bibliothèque'].filter(Boolean).join(' · ');

  return (
    <aside className="aside" aria-label="Assistant IA">
      <div className="agent-head">
        <div className="agent-avatar" aria-hidden="true">
          <Icon name="sparkle" size={18} strokeWidth={1.8} />
        </div>
        <div className="stack" style={{ gap: 1, flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 14.5 }}>{AGENT_NAMES[agent]}</strong>
          {status.checking ? (
            <span className="muted row" style={{ fontSize: 12, gap: 6 }}>
              <Spinner size={11} /> Vérification…
            </span>
          ) : found ? (
            <span className="row" style={{ fontSize: 12, gap: 6, color: 'var(--ok)', fontWeight: 600 }}>
              <span className="dot" style={{ background: 'currentColor', width: 7, height: 7 }} /> Actif
            </span>
          ) : (
            <span className="row" style={{ fontSize: 12, gap: 6, color: 'var(--err)', fontWeight: 600 }}>
              <span className="dot" style={{ background: 'currentColor', width: 7, height: 7 }} /> Introuvable
            </span>
          )}
        </div>
        <button className="btn btn-sm" onClick={() => updateSettings({ agent: 'none' })}>
          Changer
        </button>
        {close}
      </div>
      <div className="agent-context">
        <Icon name="eye" size={14} />
        Voit : {seen || 'rien'}
        {ctx && (
          <>
            {' · '}
            <span className="mono" style={{ color: 'var(--text2)' }}>
              {ctx.op.name}
            </span>
          </>
        )}
      </div>

      <div className="chat" ref={scroller} aria-live="polite">
        {!found && !status.checking && (
          <div className="notice warn">
            <Icon name="alert" />
            <span>
              {status.status?.message ?? 'Outil introuvable.'}{' '}
              <button className="btn-link" style={{ minHeight: 0 }} onClick={() => set({ screen: 'settings', settingsSection: 'agent' })}>
                Configurer
              </button>
            </span>
          </div>
        )}
        {chat.length === 0 && (
          <div className="msg-ai">
            <span className="who">{AGENT_NAMES[agent]}</span>
            <div className="text">
              Je peux expliquer une erreur, proposer des données ou des cas de test, ou rédiger un rapport de bogue
              {ctx ? (
                <>
                  {' '}pour <span className="mono">{ctx.op.name}</span>
                </>
              ) : null}
              .
            </div>
          </div>
        )}
        {chat.map((m) => (
          <Message key={m.id} m={m} ctx={ctx} />
        ))}
        {busy && (
          <div className="msg-ai">
            <span className="who">{AGENT_NAMES[agent]}</span>
            <span className="typing" aria-label="L'assistant réfléchit">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>

      <div className="composer">
        <div className="row wrap" style={{ gap: 6 }}>
          {(Object.keys(INTENT_LABEL) as (keyof typeof INTENT_LABEL)[]).map((k) => (
            <button key={k} className="chip-btn" disabled={busy || !ctx} onClick={() => ask(k)}>
              {INTENT_LABEL[k]}
            </button>
          ))}
          {chat.length > 0 && (
            <button className="chip-btn" disabled={busy} onClick={() => set({ chat: [] })}>
              Effacer
            </button>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!question.trim()) return;
            ask('free', question.trim());
            setQuestion('');
          }}
        >
          <label style={{ flex: 1, display: 'flex' }}>
            <span className="sr">Votre question</span>
            <textarea
              rows={2}
              value={question}
              placeholder="Posez une question sur cette opération…"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>
          <button type="submit" className="btn btn-primary btn-icon" style={{ width: 36, height: 36, borderRadius: 10 }} aria-label="Envoyer" disabled={busy || !question.trim()}>
            <Icon name="send" strokeWidth={2.4} />
          </button>
        </form>
      </div>
    </aside>
  );
}
