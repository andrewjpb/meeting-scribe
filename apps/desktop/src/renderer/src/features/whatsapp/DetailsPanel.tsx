import { RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useSettings } from '../../app/settingsStore'
import { phoneOfChatId } from '@shared/assistant'
import { funilPath } from '@shared/routes'
import { INSIGHTS_ERRORS, INSIGHTS_MOOD_LABELS, INSIGHTS_MOOD_NOTE, type WhatsAppInsights, type WhatsAppInsightsError } from '@shared/whatsapp-insights'
import type { WhatsAppChat, WhatsAppMessage } from '@shared/whatsapp'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { COST_HINT } from '../chat/format'
import { ContactLink, contatoLigado, useFunilCompartilhado } from '../funil/ContactLink'
import { FUNIL_LINK_CLASS } from '../funil/Timeline'
import { analysisFooterParts } from '../live/AnalysisBlock'
import { BotaoMaisTarefa, useTarefaCriada } from '../tarefas/MaisTarefa'
import { NovaTarefaInline } from '../tarefas/NovaTarefaInline'
import { ActivityChart, BalanceChart, MoodChart } from './Charts'

function PanelSection({ title, children, name }: { title: string; children: ReactNode; name: string }) {
  return (
    <section aria-label={title} data-wa-section={name} className="flex flex-col gap-2 border-b border-line px-3 py-3 last:border-b-0">
      <h3 className="label">{title}</h3>
      {children}
    </section>
  )
}

function Items({ items, empty, name }: { items: readonly string[]; empty: string; name: string }) {
  if (!items.length) return <p className="text-13 text-text-faint">{empty}</p>
  return (
    <ul data-wa-list={name} className="flex flex-col gap-1.5">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2 text-13 text-text select-text">
          <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 bg-text-faint" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Contrato 116 (R37): o bloco "Contato" no topo dos Detalhes de uma conversa com uma pessoa. Com contato ligado (pela
 * conversa ou pelo telefone), o nome como link para a ficha, o cargo e a empresa e as oportunidades dele com a etapa; sem,
 * o nome da conversa e "+ Contato". Contrato 126 (R25, artboard 12): nas duas variantes, "+ Tarefa" abaixo, que abre a
 * "Nova tarefa" em linha ligada à conversa (e ao contato, quando existe).
 */
function ContactSection({ chat }: { chat: WhatsAppChat }) {
  const view = useFunilCompartilhado()
  const navigate = useNavigate()
  const telefone = phoneOfChatId(chat.id) ?? chat.phone ?? null
  const contato = view ? contatoLigado(view.state.contatos, { telefone, whatsappChatId: chat.id }) : null
  const empresa = contato?.empresaId ? view?.state.empresas.find((item) => item.id === contato.empresaId)?.nome : undefined
  const etapas = new Map((view?.state.etapas ?? []).map((etapa) => [etapa.id, etapa.nome]))
  const oportunidades = contato ? (view?.state.oportunidades ?? []).filter((op) => !op.arquivado && op.contatoIds.includes(contato.id)) : []
  const subtitulo = [contato?.cargo, empresa].filter(Boolean).join(' · ')
  const [tarefaAberta, setTarefaAberta] = useState(false)
  const { criada, avisar } = useTarefaCriada()
  return (
    <PanelSection title="Contato" name="contato">
      <div data-whatsapp-contato={contato?.id ?? ''} className="flex flex-col gap-1.5">
        {contato ? (
          <>
            <ContactLink telefone={telefone} whatsappChatId={chat.id} nome={chat.name} origem="whatsapp" />
            {subtitulo && <p className="text-12 text-text-muted">{subtitulo}</p>}
            {oportunidades.length > 0 && (
              <ul className="flex flex-col">
                {oportunidades.map((op) => (
                  <li key={op.id} data-whatsapp-contato-oportunidade={op.id} className="flex min-h-7 items-center gap-2 border-t border-line text-12">
                    <span className="min-w-0 flex-1 truncate">
                      <button type="button" className={FUNIL_LINK_CLASS} onClick={() => void navigate(funilPath('oportunidades', op.id))}>
                        {op.titulo}
                      </button>
                    </span>
                    <span className="shrink-0 text-text-muted">{etapas.get(op.etapaId) ?? ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-13 text-text">{chat.name}</span>
            <ContactLink telefone={telefone} whatsappChatId={chat.id} nome={chat.name} origem="whatsapp" />
          </div>
        )}
      </div>
      <div className="flex">
        <BotaoMaisTarefa action="whatsapp-tarefa" avisoData="data-whatsapp-tarefa-criada" aberto={tarefaAberta} criada={criada} onClick={() => setTarefaAberta(!tarefaAberta)} />
      </div>
      {tarefaAberta && (
        <div data-whatsapp-tarefa-form>
          <NovaTarefaInline
            compacta
            origem={{ tipo: 'whatsapp', chatId: chat.id }}
            vinculosIniciais={{ whatsappChatId: chat.id, ...(contato ? { contatoIds: [contato.id] } : {}) }}
            onCriada={(id) => {
              setTarefaAberta(false)
              avisar(id)
            }}
            onCancelar={() => setTarefaAberta(false)}
          />
        </div>
      )}
    </PanelSection>
  )
}

type Phase = { kind: 'loading' } | { kind: 'idle' } | { kind: 'running' } | { kind: 'error'; error: WhatsAppInsightsError }

interface DetailsPanelProps {
  chat: WhatsAppChat
  messages: readonly WhatsAppMessage[] | undefined
  onClose: () => void
}

/**
 * Painel "Detalhes" da conversa (contrato 32), à direita, no padrão do "Contexto" do Assistente. Os gráficos são
 * locais (das mensagens carregadas); o resumo, o humor, as pendências e os compromissos vêm do Claude, que roda sozinho
 * ao abrir a conversa quando não há análise guardada para a última mensagem. A IA só lê: nada daqui envia.
 */
export function DetailsPanel({ chat, messages, onClose }: DetailsPanelProps) {
  const enabled = useSettings((state) => state.settings.whatsappInsights)
  const loaded = useSettings((state) => state.loaded)
  const update = useSettings((state) => state.update)
  const [insights, setInsights] = useState<WhatsAppInsights | null>(null)
  const [fresh, setFresh] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const alive = useRef(true)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = (): void => {
    setPhase({ kind: 'running' })
    void window.__scribeApi.invoke('scribe:whatsapp-insights-run', { chatId: chat.id }).then(
      (result) => {
        if (!alive.current) return
        if (result.ok) {
          setInsights(result.insights)
          setFresh(true)
          setPhase({ kind: 'idle' })
        } else setPhase({ kind: 'error', error: result.error })
      },
      () => {
        if (alive.current) setPhase({ kind: 'error', error: 'failed' })
      },
    )
  }

  // Ao abrir (o painel é montado por conversa): o que está guardado; sem análise da última mensagem, roda sozinho.
  useEffect(() => {
    if (!loaded || !enabled) return
    let cancelled = false
    void window.__scribeApi.invoke('scribe:whatsapp-insights', { chatId: chat.id }).then(
      (state) => {
        if (cancelled) return
        setInsights(state.insights)
        setFresh(state.fresh)
        if (state.fresh) setPhase({ kind: 'idle' })
        else run()
      },
      () => {
        if (!cancelled) setPhase({ kind: 'idle' })
      },
    )
    return () => {
      cancelled = true
    }
    // `run` muda a cada render; o efeito é só da conversa e do interruptor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, enabled, loaded])

  const loadedMessages = messages ?? []
  const footer = insights ? analysisFooterParts(insights) : null
  const running = phase.kind === 'running'

  return (
    <aside data-wa-details aria-label="Detalhes" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line bg-bg">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-1.5 pl-3">
        <h2 className="text-13 font-bold text-title">Detalhes</h2>
        <button
          type="button"
          data-action="whatsapp-details-close"
          aria-label="Fechar o painel Detalhes"
          onClick={onClose}
          className="no-drag flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-sunken hover:text-title"
        >
          <Icon icon={X} />
        </button>
      </div>

      {chat.kind === 'person' && <ContactSection chat={chat} />}

      {!enabled ? (
        <section data-wa-insights="off" className="flex flex-col gap-2 border-b border-line px-3 py-3">
          <p className="text-13 text-text-muted">Os Detalhes com IA estão desligados. Os gráficos abaixo saem só das mensagens deste Mac.</p>
          <div>
            <Button action="whatsapp-insights-enable" variant="secondary" icon={Sparkles} onClick={() => void update({ whatsappInsights: true })}>
              Ligar Detalhes com IA
            </Button>
          </div>
        </section>
      ) : (
        <>
          <PanelSection title="Resumo" name="summary">
            <div className="flex flex-wrap items-center gap-2">
              <Button action="whatsapp-insights-run" variant="secondary" icon={insights ? RefreshCw : Sparkles} onClick={run} disabled={running || phase.kind === 'loading'}>
                {insights ? 'Atualizar' : 'Analisar'}
              </Button>
              {running && (
                <span data-wa-insights-running role="status" className="text-12 text-text-muted">
                  Analisando…
                </span>
              )}
              {!running && insights && !fresh && <span className="text-12 text-text-faint">Há mensagens novas desde a análise.</span>}
            </div>
            {phase.kind === 'error' && (
              <div role="alert" data-wa-insights-error={phase.error} className="flex flex-wrap items-center gap-2 text-12 text-rec">
                <span>{INSIGHTS_ERRORS[phase.error]}</span>
                {phase.error !== 'off' && phase.error !== 'empty' && (
                  <button type="button" data-action="whatsapp-insights-retry" onClick={run} className="no-drag font-medium text-accent underline-offset-2 hover:underline">
                    Tentar de novo
                  </button>
                )}
              </div>
            )}
            {insights ? (
              <p data-wa-summary className="text-13 text-text select-text">
                {insights.resumo}
              </p>
            ) : (
              phase.kind !== 'error' && <p className="text-13 text-text-faint">{running || phase.kind === 'loading' ? 'O Claude está lendo a conversa.' : 'Sem análise ainda.'}</p>
            )}
          </PanelSection>
          {insights && (
            <>
              <PanelSection title="Pontos importantes" name="points">
                <Items items={insights.pontos} empty="Nenhum ponto destacado." name="points" />
              </PanelSection>
              <PanelSection title="Humor" name="mood">
                <p data-wa-mood-label={insights.humor.valor} className="text-15 font-bold text-title">
                  {INSIGHTS_MOOD_LABELS[insights.humor.valor]}
                </p>
                {insights.humor.justificativa && <p className="text-13 text-text select-text">{insights.humor.justificativa}</p>}
                <p className="text-12 text-text-faint">{INSIGHTS_MOOD_NOTE}</p>
                {insights.humorDias.length > 0 && <MoodChart days={insights.humorDias} />}
              </PanelSection>
              <PanelSection title="Pendências" name="pending">
                <h4 className="text-12 font-medium text-text">Minhas</h4>
                <Items items={insights.pendencias.minhas} empty="Nada pendente do seu lado." name="mine" />
                <h4 className="text-12 font-medium text-text">Deles</h4>
                <Items items={insights.pendencias.deles} empty="Nada pendente do outro lado." name="theirs" />
              </PanelSection>
              <PanelSection title="Compromissos" name="commitments">
                <Items items={insights.compromissos.map((item) => (item.quando ? `${item.texto} · ${item.quando}` : item.texto))} empty="Nenhum compromisso citado." name="commitments" />
              </PanelSection>
            </>
          )}
        </>
      )}

      <PanelSection title="Atividade" name="activity">
        <ActivityChart messages={loadedMessages} now={now} />
        <p className="text-12 text-text-faint">Mensagens por dia, das carregadas nesta conversa.</p>
      </PanelSection>
      <PanelSection title="Quem fala" name="balance">
        <BalanceChart messages={loadedMessages} group={chat.kind === 'group'} />
      </PanelSection>

      {enabled && insights && footer && (
        <p data-wa-insights-footer className="px-3 py-3 text-12 text-text-faint tabular">
          {footer.text}
          {footer.cost && (
            <span data-wa-insights-cost title={COST_HINT}>
              {' '}
              · {footer.cost}
              <span className="sr-only"> ({COST_HINT})</span>
            </span>
          )}
        </p>
      )}
    </aside>
  )
}
