import { Info } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router'
import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTab,
  settingsPath,
  SETTINGS_TABS,
  TRANSCRIPTION_ANCHOR,
  type SettingsNavigationState,
  type SettingsTab,
} from '@shared/routes'
import { LIVE_CARDS_DESCRIPTION, MEET_SPEAKERS_DESCRIPTION, WHATSAPP_AUTO_CORRECT_DESCRIPTION, WHATSAPP_INSIGHTS_DESCRIPTION } from '@shared/settings-index'
import { DAILY_RUN_LIMIT_OPTIONS, LANGUAGE_CODES, type ChatModel, type ClaudeModel, type ClaudeTransport, type CloseBehavior, type DailyRunLimitOption, type LanguageCode, type ThemeSetting, type TranslationEngine } from '@shared/settings-defaults'
import { useAgentLabel } from '../../app/agentLabel'
import { useSettings } from '../../app/settingsStore'
import { Select } from '../../design/Field'
import { PageHeader } from '../../design/PageHeader'
import { Section } from '../../design/Section'
import { Segmented } from '../../design/Segmented'
import { SettingRow } from '../../design/SettingRow'
import { Note } from '../../design/Note'
import { Switch } from '../../design/Switch'
import { tabId, tabPanelId, Tabs } from '../../design/Tabs'
import { SearchField } from '../meetings/SearchField'
import { AboutSection } from './AboutSection'
import { AccountsSection } from './AccountsSection'
import { CalendarSection } from './CalendarSection'
import { ConnectionsSection } from './ConnectionsSection'
import { MicrosoftSection } from './MicrosoftSection'
import { WhatsAppSection } from './WhatsAppSection'
import { AcpAgentField } from './AcpAgentField'
import { ApiKeyField } from './ApiKeyField'
import { BrandSection } from './BrandSection'
import { useAudioInputs } from './audioInputs'
import { ClaudeCliField } from './ClaudeCliField'
import { LockSection } from './LockSection'
import { MeetingFilesSection } from './MeetingFilesSection'
import { PluginsSection } from './PluginsSection'
import { micOptions, SYSTEM_DEFAULT } from './micOptions'
import { ModelPicker } from './ModelPicker'
import {
  HIGHLIGHT_MS,
  lastSettingsTab,
  matchesRow,
  rememberSettingsTab,
  resultsLabel,
  searchSettings,
  settingsIndex,
  SETTINGS_TAB_LABELS,
  tabForShortcut,
  type SettingsEntry,
  type SettingsResultGroup,
} from './settingsTabs'
import { UpdatesSection } from './UpdatesSection'

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  pt: 'Português',
  en: 'Inglês',
  es: 'Espanhol',
  ja: 'Japonês',
  ko: 'Coreano',
  zh: 'Chinês',
}

const LANGUAGE_OPTIONS = LANGUAGE_CODES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] }))

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
]

const ENGINES: { value: TranslationEngine; label: string }[] = [
  { value: 'assemblyai', label: 'AssemblyAI' },
  { value: 'claude-cli', label: 'Claude CLI' },
]

const CLAUDE_MODELS: { value: ClaudeModel; label: string }[] = [
  { value: 'haiku', label: 'Haiku (mais rápido)' },
  { value: 'sonnet', label: 'Sonnet' },
]

/** "Conexão com o Claude" (contrato 17, CA7): vale para tradução, resumo e chat. */
const TRANSPORTS: { value: ClaudeTransport; label: string }[] = [
  { value: 'acp', label: 'Agente (ACP, recomendado)' },
  { value: 'cli', label: 'Linha de comando' },
]

const CHAT_MODELS: { value: ChatModel; label: string }[] = [
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
]

/** "Ao fechar a janela" (contrato 23, CA9). */
const CLOSE_BEHAVIORS: { value: CloseBehavior; label: string }[] = [
  { value: 'tray', label: 'Continuar na barra de menus' },
  { value: 'quit', label: 'Sair do app' },
]

/** "Limite diário de execuções agendadas" (contrato 23, CA10). */
const DAILY_LIMITS = DAILY_RUN_LIMIT_OPTIONS.map((value) => ({ value: String(value) as `${DailyRunLimitOption}`, label: `${value} por dia` }))

const TABS = SETTINGS_TABS.map((value) => ({ value, label: SETTINGS_TAB_LABELS[value] }))
const TABS_ID = 'settings'

/** Primeiro controle de uma linha (campo, seletor, botão ou link), para o foco depois da busca. */
const CONTROL = 'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Configurações (contrato 18): título e busca no topo, as oito abas logo abaixo (fixas; só o conteúdo rola) e
 * a coluna de leitura de até 760 px, centralizada. A aba aberta fica na URL; sem ela, abre a última aberta
 * nesta sessão. Cada mudança grava na hora, como antes.
 */
export function SettingsScreen() {
  const { aba } = useParams()
  const location = useLocation()
  if (!isSettingsTab(aba)) {
    const tab = aba === undefined ? lastSettingsTab() : DEFAULT_SETTINGS_TAB
    return <Navigate replace to={{ pathname: settingsPath(tab), hash: location.hash }} state={location.state as unknown} />
  }
  return <SettingsTabs tab={aba} />
}

/**
 * As abas ficam todas montadas e só a aberta aparece (`hidden` nas outras): cada bloco carrega o que precisa
 * ao abrir Configurações, como na página única, e a busca lê as linhas de todas.
 */
function SettingsTabs({ tab }: { tab: SettingsTab }) {
  const settings = useSettings((state) => state.settings)
  const update = useSettings((state) => state.update)
  const devices = useAudioInputs()
  // Nome do agente do perfil (contrato 17, CA11).
  const agentLabel = useAgentLabel()
  const mics = micOptions(devices, settings.micDeviceId)

  const navigate = useNavigate()
  const location = useLocation()
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Depois da próxima navegação: a linha achada pela busca (com o bloco dela, se a linha não aparece) ou a aba
  // que deve receber o foco (⌘1…⌘8 e Esc).
  const pendingRef = useRef<{ row: HTMLElement | null; block: Element | null } | null>(null)
  const focusTabRef = useRef(false)
  const queryRef = useRef('')
  const [query, setQuery] = useState('')
  // Linha achada que só aparece em certa condição: "Esta opção aparece quando …".
  const [hint, setHint] = useState<SettingsEntry | null>(null)
  const entries = settingsIndex(agentLabel)
  const groups = searchSettings(entries, query)
  const resultCount = groups.reduce((total, group) => total + group.indexes.length, 0)

  useEffect(() => {
    queryRef.current = query
  })

  useEffect(() => rememberSettingsTab(tab), [tab])

  // ⌘1…⌘8 abrem a aba N enquanto Configurações está aberta.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Esc que limpou a busca (o campo já tratou o evento): o foco volta para a aba aberta.
      if (event.key === 'Escape') {
        if (event.defaultPrevented && queryRef.current) document.getElementById(tabId(TABS_ID, tab))?.focus()
        return
      }
      const next = tabForShortcut(event)
      if (!next || event.repeat) return
      event.preventDefault()
      setQuery('')
      setHint(null)
      focusTabRef.current = true
      void navigate(settingsPath(next))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, tab])

  // A cada navegação: a linha escolhida na busca (rola e destaca por 2 s), a âncora da URL (rola até o
  // bloco e foca o campo pedido) ou, sem nada disso, o topo da aba.
  useEffect(() => {
    const scroller = scrollRef.current
    const pending = pendingRef.current
    pendingRef.current = null
    if (focusTabRef.current) {
      focusTabRef.current = false
      document.getElementById(tabId(TABS_ID, tab))?.focus()
    }
    const target = pending?.row
    if (target) {
      target.scrollIntoView({ block: 'center' })
      target.querySelector<HTMLElement>(CONTROL)?.focus({ preventScroll: true })
      target.setAttribute('data-highlighted', '')
      const timer = window.setTimeout(() => target.removeAttribute('data-highlighted'), HIGHLIGHT_MS)
      return () => {
        window.clearTimeout(timer)
        target.removeAttribute('data-highlighted')
      }
    }
    if (pending?.block) {
      pending.block.scrollIntoView({ block: 'start' })
      return undefined
    }
    const anchor = location.hash.slice(1)
    const block = anchor ? document.getElementById(tabPanelId(TABS_ID, tab))?.querySelector(`[data-settings-anchor="${CSS.escape(anchor)}"]`) : null
    if (block) block.scrollIntoView({ block: 'start' })
    else if (scroller) scroller.scrollTop = 0
    const focus = (location.state as SettingsNavigationState | null)?.focus
    if (focus) document.getElementById(focus)?.focus()
    return undefined
  }, [location, tab])

  const selectTab = (next: SettingsTab): void => {
    setQuery('')
    setHint(null)
    void navigate(settingsPath(next))
  }

  const search = (value: string): void => {
    setQuery(value)
    setHint(null)
  }

  // A linha está montada (no painel da aba, mesmo escondido) ou não aparece agora: então leva ao bloco dela
  // e explica quando ela aparece.
  const open = (index: number): void => {
    const entry = entries[index]
    if (!entry) return
    const panelEl = rootRef.current?.querySelector(`[data-settings-panel="${entry.tab}"]`)
    const row = [...(panelEl?.querySelectorAll<HTMLElement>('[data-setting-row]') ?? [])].find((el) => matchesRow(entry, el.dataset.settingName ?? '')) ?? null
    const block = panelEl?.querySelector(`section[aria-label="${CSS.escape(entry.section)}"]`) ?? null
    pendingRef.current = { row, block }
    setHint(row ? null : entry)
    setQuery('')
    void navigate(settingsPath(entry.tab))
  }

  const searching = query.trim() !== ''
  const panel = (value: SettingsTab, children: ReactNode) => (
    <div
      key={value}
      role="tabpanel"
      id={tabPanelId(TABS_ID, value)}
      aria-labelledby={tabId(TABS_ID, value)}
      data-settings-panel={value}
      hidden={searching || value !== tab}
      className="flex flex-col gap-8"
    >
      {children}
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
       * O cabeçalho reserva o mesmo espaço da barra de rolagem que a área de baixo (dos dois lados, para a coluna
       * seguir centralizada): título, busca, abas e coluna ficam no mesmo `x` com e sem barra.
       */}
      <div className="overflow-hidden px-10 pt-7 [scrollbar-gutter:stable_both-edges]">
        <div className="mx-auto w-full max-w-[var(--settings-width)]">
          <PageHeader
            title="Configurações"
            actions={
              // O campo (40 px) não empurra o título (32 px) para baixo: o título fica a 28 px do topo.
              <div data-settings-search className="-my-1">
                <SearchField value={query} onChange={search} label="Buscar configuração" />
              </div>
            }
          />
          <div className="mt-5 border-b border-line">
            <Tabs value={searching ? null : tab} tabs={TABS} onChange={selectTab} label="Seções das configurações" id={TABS_ID} />
          </div>
        </div>
      </div>
      <div ref={scrollRef} data-settings-scroll className="min-h-0 flex-1 overflow-y-auto px-10 pt-8 pb-12 [scrollbar-gutter:stable_both-edges]">
        <div ref={rootRef} data-settings-column className="mx-auto flex w-full max-w-[var(--settings-width)] flex-col">
          {hint && !searching && (
            <Note id="settings-hint" icon={Info} role="status" className="mb-6">
              {`Esta opção aparece quando ${hint.when ?? 'a condição dela vale'}.`}
            </Note>
          )}
          {panel(
            'geral',
            <>
              <BrandSection />
              <Section title="Aparência">
                <SettingRow name="Tema" nameId="settings-theme">
                  <Segmented value={settings.theme} options={THEMES} labelledBy="settings-theme" dataName="theme-option" onChange={(theme) => void update({ theme })} />
                </SettingRow>
              </Section>
              {/* Contrato 23: o app continua na barra de menus, com as tarefas agendadas rodando. */}
              <Section title="Janela">
                <SettingRow name="Ao fechar a janela" nameId="settings-close-behavior" description="Na barra de menus, as tarefas agendadas continuam rodando.">
                  <Segmented value={settings.closeBehavior} options={CLOSE_BEHAVIORS} labelledBy="settings-close-behavior" dataName="close-behavior-option" onChange={(closeBehavior) => void update({ closeBehavior })} />
                </SettingRow>
                <SettingRow name="Abrir ao entrar no Mac" nameId="settings-open-at-login" description="Abre direto na barra de menus, sem janela.">
                  <Switch checked={settings.openAtLogin} labelledBy="settings-open-at-login" onChange={(openAtLogin) => void update({ openAtLogin })} />
                </SettingRow>
              </Section>
              <LockSection />
              <UpdatesSection />
            </>,
          )}

          {panel(
            'gravacao',
            <>
              <Section title="Áudio">
                <SettingRow name="Microfone" description="Usado para a sua voz." htmlFor="settings-mic">
                  <Select id="settings-mic" value={settings.micDeviceId ?? SYSTEM_DEFAULT} options={mics} onChange={(value) => void update({ micDeviceId: value === SYSTEM_DEFAULT ? null : value })} />
                </SettingRow>
                <SettingRow
                  name="Cancelamento de eco"
                  nameId="settings-echo"
                  description="Ligue se usar alto-falante em vez de fone, para a fala dos participantes não entrar pelo seu microfone."
                >
                  <Switch checked={settings.echoCancellation} labelledBy="settings-echo" onChange={(echoCancellation) => void update({ echoCancellation })} />
                </SettingRow>
              </Section>

              <Section title="Transcrição" anchor={TRANSCRIPTION_ANCHOR}>
                <ApiKeyField />
                <SettingRow
                  name="Remover eco do alto-falante"
                  nameId="settings-remove-echo"
                  description="Some com a fala dos participantes que vaza para o seu microfone quando você não usa fone."
                >
                  <Switch checked={settings.removeEcho} labelledBy="settings-remove-echo" onChange={(removeEcho) => void update({ removeEcho })} />
                </SettingRow>
                <SettingRow
                  name="Identificar quem fala"
                  nameId="settings-identify-speakers"
                  description="Separa os participantes por voz. Mais lento; desligado, as falas se dividem pelas pausas."
                >
                  <Switch checked={settings.identifySpeakers} labelledBy="settings-identify-speakers" onChange={(identifySpeakers) => void update({ identifySpeakers })} />
                </SettingRow>
                <SettingRow name="Quem fala no Meet" nameId="settings-meet-speakers" description={MEET_SPEAKERS_DESCRIPTION}>
                  <Switch checked={settings.meetSpeakers} labelledBy="settings-meet-speakers" onChange={(meetSpeakers) => void update({ meetSpeakers })} />
                </SettingRow>
              </Section>

              <Section title="Idiomas">
                <SettingRow name="Idioma falado" description="O idioma da reunião." htmlFor="settings-source">
                  <Select id="settings-source" value={settings.sourceLanguage} options={LANGUAGE_OPTIONS} onChange={(sourceLanguage) => void update({ sourceLanguage })} />
                </SettingRow>
                <SettingRow name="Traduzir ao vivo" nameId="settings-translate" description="A tradução aparece abaixo de cada fala.">
                  <Switch checked={settings.translationEnabled} labelledBy="settings-translate" onChange={(translationEnabled) => void update({ translationEnabled })} />
                </SettingRow>
                <SettingRow name="Traduzir para" htmlFor="settings-target">
                  <Select id="settings-target" value={settings.targetLanguage} options={LANGUAGE_OPTIONS} onChange={(targetLanguage) => void update({ targetLanguage })} />
                </SettingRow>
              </Section>
            </>,
          )}

          {panel(
            'claude',
            <>
              {/*
               * Tradução, resumo e o chat do "Assistente" (contratos 15 e 25) usam o mesmo `claude`: a conexão (contrato 17),
               * o agente e o caminho do `claude` ficam juntos, seguidos dos modelos.
               */}
              <Section title="Claude">
                <SettingRow name={`Conexão com o ${agentLabel}`} nameId="settings-claude-transport" description={`O agente mostra o raciocínio e os passos do ${agentLabel} direto do protocolo.`}>
                  <Segmented
                    value={settings.claudeTransport}
                    options={TRANSPORTS}
                    labelledBy="settings-claude-transport"
                    dataName="claude-transport-option"
                    onChange={(claudeTransport) => void update({ claudeTransport })}
                  />
                </SettingRow>
                <AcpAgentField />
                <ClaudeCliField />
              </Section>

              <Section title="Modelo de tradução">
                <SettingRow name="Traduzir com" nameId="settings-engine" description="O Claude CLI usa o claude instalado neste Mac, com a sua conta.">
                  <Segmented
                    value={settings.translationEngine}
                    options={ENGINES}
                    labelledBy="settings-engine"
                    dataName="engine-option"
                    onChange={(translationEngine) => void update({ translationEngine })}
                  />
                </SettingRow>
                {settings.translationEngine === 'claude-cli' ? (
                  <SettingRow name="Modelo" nameId="settings-claude-model">
                    <Segmented
                      value={settings.claudeModel}
                      options={CLAUDE_MODELS}
                      labelledBy="settings-claude-model"
                      dataName="claude-model-option"
                      onChange={(claudeModel) => void update({ claudeModel })}
                    />
                  </SettingRow>
                ) : (
                  <div className="py-4" data-setting-row data-setting-name="Modelo da AssemblyAI" data-setting-description="Lista de modelos de tradução com preço e contexto.">
                    <ModelPicker />
                  </div>
                )}
              </Section>

              <Section title="Chat e resumo">
                <SettingRow name="Modelo do chat" nameId="settings-chat-model" description="Usado no Assistente. O Opus responde melhor e demora mais.">
                  <Segmented value={settings.chatModel} options={CHAT_MODELS} labelledBy="settings-chat-model" dataName="chat-model-option" onChange={(chatModel) => void update({ chatModel })} />
                </SettingRow>
                <SettingRow name="Resumir ao encerrar" nameId="settings-summarize" description="Ao encerrar, o Claude lê a transcrição e escreve o resumo, as decisões e as tarefas.">
                  <Switch checked={settings.summarizeOnStop} labelledBy="settings-summarize" onChange={(summarizeOnStop) => void update({ summarizeOnStop })} />
                </SettingRow>
                {/* Contrato 30: o valor inicial do interruptor "IA anotando" de cada gravação. */}
                <SettingRow name="IA anotando ao vivo" nameId="settings-live-cards" description={LIVE_CARDS_DESCRIPTION}>
                  <Switch checked={settings.liveCards} labelledBy="settings-live-cards" onChange={(liveCards) => void update({ liveCards })} />
                </SettingRow>
                {/* Contrato 32: o painel Detalhes da conversa do WhatsApp com o Claude. */}
                <SettingRow name="Detalhes com IA no WhatsApp" nameId="settings-whatsapp-insights" description={WHATSAPP_INSIGHTS_DESCRIPTION}>
                  <Switch checked={settings.whatsappInsights} labelledBy="settings-whatsapp-insights" onChange={(whatsappInsights) => void update({ whatsappInsights })} />
                </SettingRow>
                {/* Contrato 35: a correção pelo Haiku dentro do envio, sem nova confirmação. */}
                <SettingRow name="Corrigir ao enviar no WhatsApp" nameId="settings-whatsapp-auto-correct" description={WHATSAPP_AUTO_CORRECT_DESCRIPTION}>
                  <Switch checked={settings.whatsappAutoCorrect} labelledBy="settings-whatsapp-auto-correct" onChange={(whatsappAutoCorrect) => void update({ whatsappAutoCorrect })} />
                </SettingRow>
              </Section>

              {/* Contrato 23 (CA10): ao passar do limite, todas as tarefas pausam e o app avisa. */}
              <Section title="Automações">
                <SettingRow name="Limite diário de execuções agendadas" description="Ao passar, todas as tarefas pausam e o app avisa." htmlFor="settings-daily-limit">
                  <Select
                    id="settings-daily-limit"
                    value={String(settings.scheduledRunsDailyLimit) as `${DailyRunLimitOption}`}
                    options={DAILY_LIMITS}
                    onChange={(value) => void update({ scheduledRunsDailyLimit: Number(value) as DailyRunLimitOption })}
                  />
                </SettingRow>
              </Section>
            </>,
          )}

          {panel('arquivos', <MeetingFilesSection />)}

          {/* Contrato 11: a conta Google e o Drive. Contrato 12: a Microsoft e as agendas. Contrato 24: o WhatsApp. */}
          {panel(
            'contas',
            <>
              <AccountsSection />
              <MicrosoftSection />
              <CalendarSection />
              <WhatsAppSection />
            </>,
          )}

          {/* Contrato 31: as extensões de navegador que vêm no app. */}
          {panel('plugins', <PluginsSection />)}

          {/* Contrato 21: os servidores MCP do Claude CLI e do app. O `claude mcp list` só roda com a aba aberta. */}
          {panel('conexoes', <ConnectionsSection active={!searching && tab === 'conexoes'} />)}

          {panel('sobre', <AboutSection />)}

          {searching && <SearchResults query={query} entries={entries} groups={groups} onOpen={open} />}
          <p aria-live="polite" data-settings-results-count className="sr-only">
            {searching ? resultsLabel(resultCount) : ''}
          </p>
        </div>
      </div>
    </div>
  )
}

interface SearchResultsProps {
  query: string
  entries: readonly SettingsEntry[]
  groups: readonly SettingsResultGroup[]
  onOpen: (index: number) => void
}

/** Resultado da busca, agrupado por aba ("Claude › Modelo do chat"); o clique leva à aba e destaca a linha. */
function SearchResults({ query, entries, groups, onOpen }: SearchResultsProps) {
  if (!groups.length) {
    return (
      <p data-settings-results="empty" className="text-13 text-text-muted">
        Nenhuma configuração com “{query.trim()}”.
      </p>
    )
  }
  return (
    <div data-settings-results className="flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.tab} role="group" aria-label={group.label} className="flex flex-col">
          <h2 className="caps text-text-muted">{group.label}</h2>
          <ul className="mt-3 flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised">
            {group.indexes.map((index) => {
              const entry = entries[index]
              if (!entry) return null
              return (
                <li key={index} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    data-settings-result={entry.tab}
                    onClick={() => onOpen(index)}
                    className="no-drag flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken focus-visible:outline-offset-[-2px]"
                  >
                    <span className="text-13 font-medium text-text">
                      {group.label} › {entry.name}
                    </span>
                    {entry.description && <span className="text-12 text-text-muted">{entry.description}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
