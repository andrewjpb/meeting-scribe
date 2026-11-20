import { ClipboardPaste, Plus, RefreshCw, ShieldAlert, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  CLAUDE_CONNECTOR_AUTHORIZE_HINT,
  CLAUDE_CONNECTOR_NEXT_QUESTION,
  CLAUDE_CONNECTOR_STATE_LABELS,
  CLAUDE_CONNECTOR_TOOLS_NOTE,
  CLAUDE_CONNECTORS_DESCRIPTION,
  CLAUDE_CONNECTORS_NO_SUBSCRIPTION,
  CLAUDE_CONNECTORS_URL,
  claudeConnectorEnabledNotice,
  connectorFirstEnable,
  MCP_ADD_DESCRIPTION,
  MCP_CLI_DESCRIPTION,
  MCP_CLI_HEALTH_LABELS,
  MCP_FIXED_WARNING,
  MCP_FOUND_DESCRIPTION,
  MCP_INDEPENDENT_NOTE,
  MCP_POLICY_LABELS,
  MCP_SECRET_MASK,
  MCP_TOOL_POLICIES,
  MCP_TRANSPORT_LABELS,
  MCP_USE_LABELS,
  MCP_USES,
  mcpStateLabel,
  mcpToolKey,
  mcpToolSuggestsWrite,
  parseMcpJson,
  withConnectorEnabled,
  withConnectorPolicy,
  type ClaudeConnector,
  type ClaudeConnectorPrefs,
  type ClaudeConnectorState,
  type ClaudeConnectorTools,
  type McpCliDetails,
  type McpCliServerView,
  type McpFoundServer,
  type McpOverview,
  type McpPair,
  type McpServerInput,
  type McpServerState,
  type McpServerView,
  type McpTestResult,
  type McpToolInfo,
  type McpToolPolicy,
  type McpTransport,
  type McpUse,
} from '@shared/mcp'
import { settingsPath } from '@shared/routes'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { Segmented } from '../../design/Segmented'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'

const SMALL_BASE =
  'no-drag inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-12 font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] disabled:pointer-events-none disabled:opacity-50'
/** Botão pequeno das ações de cada servidor (o discreto do chat, com o fio). */
const SMALL = `${SMALL_BASE} border-line-strong bg-bg-raised text-title hover:bg-bg-sunken`
/** O mesmo botão marcado (chip ligado de "Usar em"): texto na cor do fundo sobre o título, sem as cores do discreto brigando. */
const SMALL_ON = `${SMALL_BASE} border-title bg-title text-bg`
const SMALL_DANGER =
  'no-drag inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 text-12 font-medium text-rec transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken disabled:pointer-events-none disabled:opacity-50'
const SMALL_SELECT = 'no-drag h-8 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-1.5 text-12 text-text'
const AREA =
  'no-drag min-h-20 w-full resize-y rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-3 py-2 font-mono text-12 text-text select-text placeholder:text-text-faint'

/** Só os valores de variáveis e cabeçalhos são mascarados; o que estiver nos argumentos aparece como está. */
const SECRET_IN_ARGS = 'Segredo nos argumentos não é mascarado: use uma variável marcada como segredo.'

const POLICY_OPTIONS = MCP_TOOL_POLICIES.map((value) => ({ value, label: MCP_POLICY_LABELS[value] }))

/** Estado na tela, com a cor: só o erro em vermelho. */
function StateText({ state }: { state: McpServerState }) {
  return <span className={state.kind === 'error' ? 'text-rec' : state.kind === 'connected' ? 'text-live' : 'text-text-muted'}>{mcpStateLabel(state)}</span>
}

/** Usos do servidor (chat e análise), como botões de marcar. */
function UsesPicker({ uses, onChange, disabled = false }: { uses: readonly McpUse[]; onChange: (uses: McpUse[]) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Usos" className="flex flex-wrap items-center gap-1.5">
      <span className="text-12 text-text-muted">Usar em</span>
      {MCP_USES.map((use) => {
        const on = uses.includes(use)
        return (
          <button
            key={use}
            type="button"
            data-mcp-use={use}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? uses.filter((item) => item !== use) : [...uses, use])}
            className={on ? SMALL_ON : SMALL}
          >
            {MCP_USE_LABELS[use]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * As ferramentas do último teste, com a regra de cada uma. Nome e descrição vêm do servidor: só texto. Contrato 58: com
 * `markWrite` (conectores do claude.ai), o rótulo "Escrita" quando o nome sugere escrita; a regra não muda por isso.
 */
function ToolsList({
  tools,
  policy,
  onPolicy,
  markWrite = false,
}: {
  tools: readonly McpToolInfo[]
  policy: Readonly<Record<string, McpToolPolicy>>
  onPolicy?: ((tool: string, policy: McpToolPolicy) => void) | undefined
  markWrite?: boolean
}) {
  if (!tools.length) return null
  return (
    <ul data-mcp-tools className="flex flex-col divide-y divide-line rounded-[var(--radius-control)] border border-line">
      {tools.map((tool) => (
        <li key={tool.name} data-mcp-tool={tool.name} className="flex items-center gap-3 px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-col">
            {markWrite ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-12 text-text">{tool.name}</span>
                {mcpToolSuggestsWrite(tool.name) && (
                  <span data-mcp-tool-write className="inline-flex h-[18px] shrink-0 items-center rounded-[var(--radius-control)] border border-line-strong px-1.5 text-11 font-medium text-text-muted">
                    Escrita
                  </span>
                )}
              </span>
            ) : (
              <span className="truncate font-mono text-12 text-text">{tool.name}</span>
            )}
            {tool.description && <span className="truncate text-12 text-text-muted">{tool.description}</span>}
          </div>
          {onPolicy && (
            <select aria-label={`Regra de ${tool.name}`} data-mcp-policy={tool.name} value={policy[mcpToolKey(tool.name)] ?? 'ask'} onChange={(event) => onPolicy(tool.name, event.target.value as McpToolPolicy)} className={SMALL_SELECT}>
              {POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </li>
      ))}
    </ul>
  )
}

interface ServerItemProps {
  index: string
  kind: 'cli' | 'app'
  server: McpCliServerView | McpServerView
  onOverview: (overview: McpOverview) => void
  onEdit?: (() => void) | undefined
}

/** Um servidor da lista ("Do Claude CLI" ou "Servidores do app"): interruptor, usos, testar, detalhes, editar e remover. */
function ServerItem({ index, kind, server, onOverview, onEdit }: ServerItemProps) {
  const nameId = `mcp-server-${index}`
  const cli = kind === 'cli' ? (server as McpCliServerView) : null
  const usable = cli ? cli.usable : true
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<McpTestResult | null>(null)
  const [details, setDetails] = useState<McpCliDetails | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (patch: { enabled?: boolean; uses?: McpUse[]; tool?: string; policy?: McpToolPolicy }): void => {
    void window.__scribeApi.invoke('scribe:mcp-update', { key: server.key, ...patch }).then(
      (next) => {
        if (next) onOverview(next)
      },
      () => setError('Não foi possível gravar.'),
    )
  }
  const runTest = (): void => {
    setBusy(true)
    setError(null)
    void window.__scribeApi
      .invoke('scribe:mcp-test', { key: server.key })
      .then(
        (result) => {
          setTest(result)
          return window.__scribeApi.invoke('scribe:mcp-overview', {}).then(onOverview)
        },
        () => setTest({ ok: false, error: 'falha na conexão' }),
      )
      .finally(() => setBusy(false))
  }
  const showDetails = (): void => {
    if (details) {
      setDetails(null)
      return
    }
    void window.__scribeApi.invoke('scribe:mcp-details', { name: server.name }).then(
      (result) => setDetails(result ?? { name: server.name, lines: [] }),
      () => setDetails({ name: server.name, lines: [] }),
    )
  }
  const remove = (): void => {
    setBusy(true)
    void window.__scribeApi
      .invoke('scribe:mcp-remove', { key: server.key })
      .then(
        (result) => {
          if (result.ok) onOverview(result.overview)
          else setError(result.error)
        },
        () => setError('Não foi possível remover.'),
      )
      .finally(() => {
        setBusy(false)
        setConfirming(false)
      })
  }

  const type = server.transport === 'other' ? 'Outro tipo' : MCP_TRANSPORT_LABELS[server.transport]
  const subtitle = cli ? `${type} · CLI: ${MCP_CLI_HEALTH_LABELS[cli.health]}` : type
  return (
    <div data-mcp-server={server.key} data-mcp-state={server.state.kind} className="flex flex-col gap-3 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p id={nameId} className="truncate text-13 font-medium text-text">
            {server.name}
          </p>
          <p className="text-12 text-text-muted">
            {subtitle} · <StateText state={server.state} />
          </p>
          {!usable && <p className="text-12 text-text-faint">Não dá para usar no app: este servidor não está no escopo user do Claude CLI (de plugins).</p>}
        </div>
        <Switch checked={server.enabled} labelledBy={nameId} action="mcp-toggle" disabled={!usable} onChange={(enabled) => update({ enabled })} />
      </div>
      {usable && (
        <>
          <UsesPicker uses={server.uses} disabled={!server.enabled} onChange={(uses) => update({ uses })} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-action="mcp-test" disabled={busy} onClick={runTest} className={SMALL}>
              {busy ? 'Testando…' : 'Testar'}
            </button>
            {cli && (
              <button type="button" data-action="mcp-details" aria-expanded={details !== null} onClick={showDetails} className={SMALL}>
                Ver detalhes
              </button>
            )}
            {onEdit && (
              <button type="button" data-action="mcp-edit" onClick={onEdit} className={SMALL}>
                Editar
              </button>
            )}
            <button type="button" data-action="mcp-remove" disabled={busy} onClick={() => setConfirming(true)} className={SMALL_DANGER}>
              <Icon icon={Trash2} size={14} />
              Remover
            </button>
          </div>
        </>
      )}
      {confirming && (
        <div data-mcp-remove-confirm role="alertdialog" aria-label="Remover servidor" className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-line bg-bg-sunken px-3 py-2">
          <p className="min-w-0 flex-1 text-12 text-text">{cli ? 'Remover também do Claude CLI do terminal?' : 'Remover este servidor do app?'}</p>
          <button type="button" data-action="mcp-remove-confirm" onClick={remove} className={SMALL_DANGER}>
            {cli ? 'Remover do Claude CLI' : 'Remover'}
          </button>
          <button type="button" data-action="mcp-remove-cancel" onClick={() => setConfirming(false)} className={SMALL}>
            Cancelar
          </button>
        </div>
      )}
      {test && !test.ok && (
        <p data-mcp-test="error" role="status" className="text-12 text-rec">
          Erro: {test.error}
        </p>
      )}
      {test?.ok && (
        <p data-mcp-test="ok" role="status" className="text-12 text-text-muted">
          {test.tools.length === 1 ? '1 ferramenta encontrada.' : `${test.tools.length} ferramentas encontradas.`}
        </p>
      )}
      {usable && <ToolsList tools={server.tools} policy={server.toolPolicy} onPolicy={(tool, policy) => update({ tool, policy })} />}
      {details && (
        <dl data-mcp-details className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-[var(--radius-control)] border border-line bg-bg-sunken px-3 py-2 text-12">
          <dd className="col-span-2 text-text-faint">{SECRET_IN_ARGS}</dd>
          {details.lines.length ? (
            details.lines.map((line, at) => (
              <div key={at} className="contents">
                <dt className="text-text-muted">{line.label}</dt>
                <dd className="min-w-0 font-mono break-all text-text select-text">{line.value}</dd>
              </div>
            ))
          ) : (
            <dd className="col-span-2 text-text-muted">Sem detalhes do Claude CLI.</dd>
          )}
        </dl>
      )}
      {error && (
        <p data-mcp-feedback="error" role="alert" className="text-12 text-rec">
          {error}
        </p>
      )}
    </div>
  )
}

/** Um par (variável ou cabeçalho) no formulário. `defined`: segredo já guardado que fica se o campo seguir vazio. */
interface FormPair extends McpPair {
  defined?: boolean
}

interface FormState {
  id?: string | undefined
  target: 'cli' | 'app'
  name: string
  kind: 'stdio' | 'http'
  http: 'http' | 'sse'
  command: string
  args: string
  cwd: string
  env: FormPair[]
  url: string
  headers: FormPair[]
  uses: McpUse[]
}

const emptyForm = (): FormState => ({ target: 'cli', name: '', kind: 'stdio', http: 'http', command: '', args: '', cwd: '', env: [], url: '', headers: [], uses: ['chat'] })

/** O formulário de editar a partir de um servidor do app (os segredos ficam guardados: o valor não vem). */
function formOf(server: McpServerView): FormState {
  const pairs = (list: McpServerView['env']): FormPair[] => list.map((pair) => ({ key: pair.key, value: pair.value ?? '', secret: pair.secret, keep: pair.secret && pair.defined, defined: pair.defined }))
  return {
    id: server.id,
    target: 'app',
    name: server.name,
    kind: server.transport === 'stdio' ? 'stdio' : 'http',
    http: server.transport === 'sse' ? 'sse' : 'http',
    command: server.command ?? '',
    args: server.args.join('\n'),
    cwd: server.cwd ?? '',
    env: pairs(server.env),
    url: server.url ?? '',
    headers: pairs(server.headers),
    uses: server.uses,
  }
}

function inputOf(form: FormState): McpServerInput {
  const pairs = (list: FormPair[]): McpPair[] => list.filter((pair) => pair.key.trim() || pair.value).map((pair) => ({ key: pair.key.trim(), value: pair.value, secret: pair.secret, ...(pair.keep ? { keep: true } : {}) }))
  const transport: McpTransport = form.kind === 'stdio' ? 'stdio' : form.http
  return {
    ...(form.id ? { id: form.id } : {}),
    target: form.target,
    name: form.name.trim(),
    transport,
    uses: form.uses,
    ...(transport === 'stdio'
      ? {
          command: form.command.trim(),
          args: form.args.split('\n').map((arg) => arg.trim()).filter(Boolean),
          ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
          env: pairs(form.env),
        }
      : { url: form.url.trim(), headers: pairs(form.headers) }),
  }
}

/** Variáveis ou cabeçalhos: chave, valor e "segredo", um por linha. */
function PairsEditor({ label, kind, pairs, onChange }: { label: string; kind: 'env' | 'header'; pairs: FormPair[]; onChange: (pairs: FormPair[]) => void }) {
  const set = (at: number, patch: Partial<FormPair>): void => onChange(pairs.map((pair, index) => (index === at ? { ...pair, ...patch } : pair)))
  return (
    <div className="flex flex-col gap-2">
      <p className="text-12 font-medium text-text">{label}</p>
      {pairs.map((pair, at) => (
        <div key={at} data-mcp-pair={kind} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            data-mcp-pair-key
            aria-label={`Nome ${at + 1}`}
            value={pair.key}
            placeholder={kind === 'env' ? 'NOME' : 'Authorization'}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => set(at, { key: event.target.value })}
            className="no-drag h-8 w-40 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 font-mono text-12 text-text select-text"
          />
          <input
            type={pair.secret ? 'password' : 'text'}
            data-mcp-pair-value
            aria-label={`Valor ${at + 1}`}
            value={pair.value}
            placeholder={pair.keep ? `${MCP_SECRET_MASK} definido` : pair.secret && pair.defined === false ? 'Falta preencher' : 'valor'}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => set(at, { value: event.target.value, keep: false })}
            className="no-drag h-8 min-w-0 flex-[1_1_160px] rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-2 font-mono text-12 text-text select-text placeholder:text-text-faint"
          />
          <label className="flex items-center gap-1.5 text-12 text-text-muted">
            <input type="checkbox" data-mcp-pair-secret checked={pair.secret} onChange={(event) => set(at, { secret: event.target.checked, ...(event.target.checked ? {} : { keep: false }) })} className="no-drag size-4 accent-accent" />
            Segredo
          </label>
          <button type="button" aria-label={`Tirar ${pair.key || 'linha'}`} onClick={() => onChange(pairs.filter((_pair, index) => index !== at))} className="no-drag flex size-8 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-sunken hover:text-title">
            <Icon icon={X} size={14} />
          </button>
        </div>
      ))}
      <button type="button" data-action={kind === 'env' ? 'mcp-form-add-env' : 'mcp-form-add-header'} onClick={() => onChange([...pairs, { key: '', value: '', secret: true }])} className={`${SMALL} self-start`}>
        <Icon icon={Plus} size={14} />
        {kind === 'env' ? 'Variável' : 'Cabeçalho'}
      </button>
    </div>
  )
}

/**
 * "Adicionar servidor MCP" (CA3) e "Editar": "Comando local (stdio)" ou "Endereço (HTTP)", ou o JSON do Claude Desktop
 * colado. "Testar conexão" sobe o servidor no main e lista as ferramentas; só depois disso, e sem mudar nada no
 * formulário, "Salvar" fica ativo.
 */
function ServerForm({ initial, onDone, onCancel }: { initial: FormState; onDone: (overview: McpOverview) => void; onCancel: () => void }) {
  const [form, setForm] = useState<FormState>(initial)
  const [json, setJson] = useState<string | null>(null)
  const [jsonNote, setJsonNote] = useState<string | null>(null)
  const [test, setTest] = useState<{ result: McpTestResult; key: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = form.id !== undefined
  const key = JSON.stringify(inputOf(form))
  const tested = test?.result.ok === true && test.key === key
  const change = (patch: Partial<FormState>): void => {
    setForm((current) => ({ ...current, ...patch }))
    setError(null)
  }

  const fillFromJson = (): void => {
    const parsed = parseMcpJson(json ?? '')
    if (!parsed.ok) {
      setJsonNote(parsed.error)
      return
    }
    const first = parsed.servers[0]
    if (!first) return
    change({
      name: first.name || form.name,
      kind: first.transport === 'stdio' ? 'stdio' : 'http',
      http: first.transport === 'sse' ? 'sse' : 'http',
      command: first.command,
      args: first.args.join('\n'),
      env: first.env,
      url: first.url,
      headers: first.headers,
    })
    setJson(null)
    setJsonNote(parsed.servers.length > 1 ? `O JSON tem ${parsed.servers.length} servidores; o formulário recebeu o primeiro.` : null)
  }
  const runTest = (): void => {
    const draft = inputOf(form)
    const at = JSON.stringify(draft)
    setBusy(true)
    setError(null)
    void window.__scribeApi
      .invoke('scribe:mcp-test', { draft })
      .then(
        (result) => setTest({ result, key: at }),
        () => setTest({ result: { ok: false, error: 'falha na conexão' }, key: at }),
      )
      .finally(() => setBusy(false))
  }
  const save = (): void => {
    setBusy(true)
    void window.__scribeApi
      .invoke('scribe:mcp-save', inputOf(form))
      .then(
        (result) => {
          if (result.ok) onDone(result.overview)
          else setError(result.error)
        },
        () => setError('Não foi possível salvar.'),
      )
      .finally(() => setBusy(false))
  }

  return (
    <div data-mcp-form={editing ? 'edit' : 'new'} className="flex flex-col gap-4 bg-bg-sunken py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-13 font-bold text-title">{editing ? `Editar ${initial.name}` : 'Novo servidor MCP'}</p>
        {!editing && (
          <button type="button" data-action="mcp-form-json" aria-expanded={json !== null} onClick={() => setJson(json === null ? '' : null)} className={SMALL}>
            <Icon icon={ClipboardPaste} size={14} />
            Colar JSON
          </button>
        )}
      </div>
      {json !== null && (
        <div className="flex flex-col gap-2">
          <label htmlFor="mcp-form-json" className="text-12 text-text-muted">
            O formato do Claude Desktop: {'{"mcpServers": {"nome": {"command": "…", "args": […], "env": {…}}}}'}. Os valores das variáveis entram como segredo.
          </label>
          <textarea id="mcp-form-json" value={json} spellCheck={false} onChange={(event) => setJson(event.target.value)} className={AREA} />
          <button type="button" data-action="mcp-form-paste" onClick={fillFromJson} className={`${SMALL} self-start`}>
            Preencher o formulário
          </button>
        </div>
      )}
      {jsonNote && (
        <p data-mcp-json-note role="status" className="text-12 text-text-muted">
          {jsonNote}
        </p>
      )}
      <span id="mcp-form-kind" className="sr-only">
        Tipo do servidor
      </span>
      <Segmented
        value={form.kind}
        options={[
          { value: 'stdio', label: 'Comando local (stdio)' },
          { value: 'http', label: 'Endereço (HTTP)' },
        ]}
        labelledBy="mcp-form-kind"
        dataName="mcp-form-kind"
        onChange={(kind) => change({ kind })}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mcp-form-name" className="text-12 font-medium text-text">
          Nome
        </label>
        <TextField id="mcp-form-name" value={form.name} maxLength={40} placeholder="ex.: calculadora" onChange={(name) => change({ name })} />
      </div>
      {form.kind === 'stdio' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mcp-form-command" className="text-12 font-medium text-text">
              Comando
            </label>
            <TextField id="mcp-form-command" value={form.command} placeholder="npx" onChange={(command) => change({ command })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mcp-form-args" className="text-12 font-medium text-text">
              Argumentos (um por linha)
            </label>
            <textarea id="mcp-form-args" value={form.args} spellCheck={false} onChange={(event) => change({ args: event.target.value })} className={AREA} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mcp-form-cwd" className="text-12 font-medium text-text">
              Pasta de trabalho (opcional, só neste app)
            </label>
            <TextField id="mcp-form-cwd" value={form.cwd} placeholder="/Users/…" onChange={(cwd) => change({ cwd })} />
            <p className="text-12 text-text-faint">Vale no teste; na conversa, o agente roda o comando a partir da pasta dele.</p>
          </div>
          <PairsEditor label="Variáveis de ambiente" kind="env" pairs={form.env} onChange={(env) => change({ env })} />
          <p className="text-12 text-text-faint">{SECRET_IN_ARGS}</p>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mcp-form-url" className="text-12 font-medium text-text">
              Endereço
            </label>
            <TextField id="mcp-form-url" value={form.url} placeholder="https://…" onChange={(url) => change({ url })} />
            <p className="text-12 text-text-faint">https://, ou http:// só no próprio Mac (127.0.0.1 ou localhost).</p>
          </div>
          <span id="mcp-form-http" className="sr-only">
            Protocolo do endereço
          </span>
          <Segmented
            value={form.http}
            options={[
              { value: 'http', label: 'HTTP' },
              { value: 'sse', label: 'SSE' },
            ]}
            labelledBy="mcp-form-http"
            dataName="mcp-form-http"
            onChange={(http) => change({ http })}
          />
          <PairsEditor label="Cabeçalhos" kind="header" pairs={form.headers} onChange={(headers) => change({ headers })} />
        </>
      )}
      {/* No Claude CLI, o servidor chega desligado para o app; os usos se escolhem ao ligar, na lista. */}
      {form.target === 'app' && <UsesPicker uses={form.uses} onChange={(uses) => change({ uses })} />}
      {!editing && (
        <div
          role="radiogroup"
          aria-label="Onde salvar"
          onKeyDown={(event) => {
            // Setas trocam e marcam (tabindex móvel, como os outros grupos de rádio do app).
            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 'cli' : event.key === 'End' ? 'app' : form.target === 'cli' ? 'app' : 'cli'
            change({ target: next })
            event.currentTarget.querySelector<HTMLButtonElement>(`[data-mcp-form-target="${next}"]`)?.focus()
          }}
          className="flex flex-col gap-1"
        >
          {(
            [
              ['cli', 'Salvar no Claude CLI (vale também no terminal)'],
              ['app', 'Só neste app'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.target === value}
              tabIndex={form.target === value ? 0 : -1}
              data-mcp-form-target={value}
              onClick={() => change({ target: value })}
              className={`no-drag flex h-8 items-center gap-2 rounded-[var(--radius-control)] px-1 text-left text-13 hover:bg-bg-raised ${form.target === value ? 'font-medium text-title' : 'text-text'}`}
            >
              <span aria-hidden="true" className={`size-2 shrink-0 border ${form.target === value ? 'border-accent bg-accent' : 'border-line-strong'}`} />
              {label}
            </button>
          ))}
        </div>
      )}
      {test && test.key === key && !test.result.ok && (
        <p data-mcp-form-result="error" role="status" className="text-12 text-rec">
          Erro: {test.result.error}
        </p>
      )}
      {test && test.key === key && test.result.ok && (
        <div data-mcp-form-result="ok" role="status" className="flex flex-col gap-2">
          <p className="text-12 text-text-muted">{test.result.tools.length === 1 ? 'Conectou: 1 ferramenta.' : `Conectou: ${test.result.tools.length} ferramentas.`}</p>
          <ToolsList tools={test.result.tools} policy={{}} />
        </div>
      )}
      {error && (
        <p data-mcp-feedback="error" role="alert" className="text-12 text-rec">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button action="mcp-form-test" variant="secondary" disabled={busy || !form.name.trim()} onClick={runTest}>
          {busy && !tested ? 'Testando…' : 'Testar conexão'}
        </Button>
        <Button action="mcp-form-save" disabled={busy || !tested} onClick={save}>
          Salvar
        </Button>
        <Button action="mcp-form-cancel" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

/** Um servidor do Claude Desktop: só o nome, o tipo, o programa e os nomes das variáveis; nenhum valor. */
function FoundItem({ server, onOverview }: { server: McpFoundServer; onOverview: (overview: McpOverview) => void }) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const importTo = (target: 'cli' | 'app'): void => {
    setBusy(true)
    void window.__scribeApi
      .invoke('scribe:mcp-import', { id: server.id, target })
      .then(
        (result) => {
          if (result.ok) {
            onOverview(result.overview)
            setFeedback({ ok: true, text: target === 'cli' ? 'Importado para o Claude CLI.' : 'Importado para os servidores do app, desligado. Preencha os segredos antes de ligar.' })
          } else setFeedback({ ok: false, text: result.error })
        },
        () => setFeedback({ ok: false, text: 'Não foi possível importar.' }),
      )
      .finally(() => setBusy(false))
  }
  const keys = [...server.envKeys, ...server.headerKeys]
  return (
    <div data-mcp-found={server.id} className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-13 font-medium text-text">{server.name}</p>
          <p className="text-12 text-text-muted">
            {server.sourceLabel} · {MCP_TRANSPORT_LABELS[server.transport]}
            {server.command ? ` · ${server.command}` : ''}
            {server.url ? ` · ${server.url}` : ''}
          </p>
          {keys.length > 0 && <p className="text-12 text-text-faint">Segredos que não vêm: {keys.join(', ')}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-action="mcp-import-cli" disabled={busy} onClick={() => importTo('cli')} className={SMALL}>
            Para o Claude CLI
          </button>
          <button type="button" data-action="mcp-import-app" disabled={busy} onClick={() => importTo('app')} className={SMALL}>
            Só no app
          </button>
        </div>
      </div>
      {feedback && (
        <p data-mcp-feedback={feedback.ok ? 'imported' : 'error'} role="status" className={`text-12 ${feedback.ok ? 'text-text-muted' : 'text-rec'}`}>
          {feedback.text}
        </p>
      )}
    </div>
  )
}

/** Contrato 58: o estado do conector na linha, com a cor: conectado em --live, com problema em --rec. */
function ConnectorStateText({ state }: { state: ClaudeConnectorState }) {
  return <span className={state === 'connected' ? 'text-live' : state === 'failed' ? 'text-rec' : 'text-text-muted'}>{CLAUDE_CONNECTOR_STATE_LABELS[state]}</span>
}

/**
 * Contrato 58: um conector do claude.ai. Interruptor (desligado por padrão; só liga conectado), o estado, o link para
 * autorizar no claude.ai, "Ver ferramentas" com a regra de cada uma e, depois de ligar ou desligar, o aviso de que vale na
 * próxima pergunta (CA5); ao ligar pela primeira vez, o aviso de uma linha do CA2. Tudo grava em
 * `settings.claudeConnectors`, que o main valida.
 */
function ConnectorItem({ index, connector }: { index: number; connector: ClaudeConnector }) {
  const nameId = `claude-connector-${index}`
  const prefs = useSettings((state) => state.settings.claudeConnectors[connector.name])
  const update = useSettings((state) => state.update)
  const enabled = prefs?.enabled === true
  const connected = connector.state === 'connected'
  const [changed, setChanged] = useState<'first' | 'again' | null>(null)
  const [tools, setTools] = useState<ClaudeConnectorTools | 'loading' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = (next: (current: Readonly<Record<string, ClaudeConnectorPrefs>>) => Record<string, ClaudeConnectorPrefs>): Promise<boolean> =>
    update({ claudeConnectors: next(useSettings.getState().settings.claudeConnectors) }).then((ok) => {
      setError(ok ? null : 'Não foi possível gravar.')
      return ok
    })
  const toggle = (on: boolean): void => {
    // "Primeira vez": o conector nunca foi ligado (uma regra escolhida antes, desligado, não conta).
    const first = on && connectorFirstEnable(useSettings.getState().settings.claudeConnectors, connector.name)
    void save((current) => withConnectorEnabled(current, connector.name, on)).then((ok) => {
      if (ok) setChanged(first ? 'first' : 'again')
    })
  }
  const showTools = (): void => {
    if (tools !== null) {
      setTools(null)
      return
    }
    setTools('loading')
    void window.__scribeApi.invoke('scribe:mcp-connector-tools', { name: connector.name }).then(setTools, () => setTools({ ok: false, error: 'Não foi possível ler as ferramentas do conector.' }))
  }

  return (
    <div data-connector={connector.name} data-connector-state={connector.state} data-connector-enabled={enabled} className="flex flex-col gap-3 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p id={nameId} className="truncate text-13 font-medium text-text">
            {connector.name}
          </p>
          <p className="text-12 text-text-muted">
            Conector do claude.ai · <ConnectorStateText state={connector.state} />
          </p>
          {connector.state === 'needs-auth' && (
            <p className="text-12 text-text-muted">
              {CLAUDE_CONNECTOR_AUTHORIZE_HINT}{' '}
              <a
                href={CLAUDE_CONNECTORS_URL}
                data-action="connector-authorize"
                onClick={(event) => {
                  event.preventDefault()
                  window.__scribeApi.send('scribe:open-link', CLAUDE_CONNECTORS_URL)
                }}
                className="no-drag rounded-[var(--radius-control)] font-medium text-accent underline decoration-1 underline-offset-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
              >
                Autorizar no claude.ai
              </a>
            </p>
          )}
          {changed && (
            <p data-connector-next role="status" className="text-12 text-text-muted">
              {CLAUDE_CONNECTOR_NEXT_QUESTION}
            </p>
          )}
        </div>
        {/* Só liga conectado; ligado antes, desliga em qualquer estado. */}
        <Switch checked={enabled} labelledBy={nameId} action="connector-toggle" disabled={!connected && !enabled} onChange={toggle} />
      </div>
      {changed === 'first' && enabled && (
        <div data-notice="connector-enabled" role="status" className="border-l-3 border-title bg-bg-sunken px-3 py-2 text-12">
          <p className="text-pretty text-text">{claudeConnectorEnabledNotice(connector.name)}</p>
        </div>
      )}
      {connected && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-action="connector-tools" aria-expanded={tools !== null} disabled={tools === 'loading'} onClick={showTools} className={SMALL}>
            {tools === 'loading' ? 'Lendo…' : tools !== null ? 'Ocultar ferramentas' : 'Ver ferramentas'}
          </button>
        </div>
      )}
      {connected && tools !== null && tools !== 'loading' && !tools.ok && (
        <p data-connector-tools="error" role="status" className="text-12 text-rec">
          {tools.error}
        </p>
      )}
      {connected && tools !== null && tools !== 'loading' && tools.ok && (
        <>
          {tools.tools.length ? (
            <ToolsList tools={tools.tools} policy={prefs?.tools ?? {}} markWrite onPolicy={(tool, policy) => void save((current) => withConnectorPolicy(current, connector.name, tool, policy))} />
          ) : (
            <p className="text-12 text-text-muted">Nenhuma ferramenta neste conector.</p>
          )}
          <p className="text-12 text-text-faint">{CLAUDE_CONNECTOR_TOOLS_NOTE}</p>
        </>
      )}
      {error && (
        <p data-mcp-feedback="error" role="alert" className="text-12 text-rec">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Contrato 58: "Conectores do claude.ai", por último na aba. A lista vem do mesmo `claude mcp list` da seção "Do Claude
 * CLI" (linhas `claude.ai <Nome>`); sem login por assinatura, só a frase do CA4 e o atalho para Configurações › Claude.
 */
function ConnectorsSection({ overview }: { overview: McpOverview | null }) {
  const navigate = useNavigate()
  const cli = overview?.cli.state ?? 'loading'
  const list = overview?.connectors ?? { connectors: [], reason: null }
  const count = list.connectors.length
  const state = cli !== 'ok' ? cli : list.reason ?? 'ok'
  return (
    <Section title="Conectores do claude.ai">
      <SettingRow name="Conectores da sua conta" description={CLAUDE_CONNECTORS_DESCRIPTION}>
        {cli === 'ok' && list.reason !== 'no-subscription' && (
          <span data-connectors-count className="text-13 text-text-muted">
            {count === 0 ? 'Nenhum conector' : count === 1 ? '1 conector' : `${count} conectores`}
          </span>
        )}
      </SettingRow>
      <div data-connectors-section={state} className="flex flex-col divide-y divide-line">
        {cli === 'loading' && <p className="py-4 text-12 text-text-muted">Lendo o claude mcp list…</p>}
        {cli === 'not-found' && <p className="py-4 text-12 text-text-muted">O claude não foi encontrado neste Mac.</p>}
        {cli === 'error' && <p className="py-4 text-12 text-rec">Não foi possível ler os conectores do claude.ai.</p>}
        {cli === 'ok' && list.reason === 'no-subscription' && (
          <div data-connectors-no-subscription className="flex flex-wrap items-center gap-3 py-4">
            <p className="min-w-0 flex-[1_1_320px] text-13 text-text">{CLAUDE_CONNECTORS_NO_SUBSCRIPTION}</p>
            <button type="button" data-action="connectors-open-claude-settings" onClick={() => void navigate(settingsPath('claude'))} className={SMALL}>
              Abrir Configurações › Claude
            </button>
          </div>
        )}
        {cli === 'ok' && list.reason === 'none' && <p className="py-4 text-12 text-text-muted">Nenhum conector na sua conta do claude.ai.</p>}
        {cli === 'ok' &&
          list.connectors.map((connector, index) => (
            <ConnectorItem key={connector.name} index={index} connector={connector} />
          ))}
      </div>
    </Section>
  )
}

/**
 * Aba "Conexões" (contrato 21): o aviso fixo, os servidores do Claude CLI (CA0), os do app (CA1, CA2) com
 * "Adicionar servidor MCP" (CA3) e os encontrados no Claude Desktop (CA2). O `claude mcp list` (que sobe os servidores
 * para conferir a saúde) só roda com a aba aberta; "Atualizar" lê de novo. Contrato 58: os conectores do claude.ai, por
 * último, da mesma lista.
 */
export function ConnectionsSection({ active }: { active: boolean }) {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<McpOverview | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const asked = useRef(false)

  useEffect(() => {
    void window.__scribeApi.invoke('scribe:mcp-overview', {}).then(setOverview, () => undefined)
  }, [])

  useEffect(() => {
    if (!active || asked.current) return
    asked.current = true
    void window.__scribeApi.invoke('scribe:mcp-overview', { cli: true }).then(setOverview, () => {
      asked.current = false
    })
  }, [active])

  const refresh = (): void => {
    setRefreshing(true)
    void window.__scribeApi
      .invoke('scribe:mcp-overview', { cli: true, refresh: true })
      .then(setOverview, () => undefined)
      .finally(() => setRefreshing(false))
  }

  const cli = overview?.cli
  const found = overview?.found ?? []
  return (
    <>
      <Note id="mcp-warning" icon={ShieldAlert}>
        {MCP_FIXED_WARNING} {MCP_INDEPENDENT_NOTE}
      </Note>

      <Section title="Do Claude CLI">
        <SettingRow name="Servidores do Claude CLI" description={MCP_CLI_DESCRIPTION}>
          <Button action="mcp-cli-refresh" variant="secondary" icon={RefreshCw} disabled={refreshing || cli?.state === 'loading'} onClick={refresh}>
            {refreshing ? 'Lendo…' : 'Atualizar'}
          </Button>
        </SettingRow>
        <div data-mcp-section="cli" data-mcp-cli-state={cli?.state ?? 'loading'} className="flex flex-col divide-y divide-line empty:hidden">
          {(!cli || cli.state === 'loading') && <p className="py-4 text-12 text-text-muted">Lendo o claude mcp list…</p>}
          {cli?.state === 'not-found' && (
            <div className="flex flex-wrap items-center gap-3 py-4">
              <p className="min-w-0 flex-1 text-12 text-text-muted">O claude não foi encontrado neste Mac.</p>
              <button type="button" data-action="mcp-open-claude-settings" onClick={() => void navigate(settingsPath('claude'))} className={SMALL}>
                Abrir Configurações › Claude
              </button>
            </div>
          )}
          {cli?.state === 'error' && <p className="py-4 text-12 text-rec">Não foi possível ler os servidores do Claude CLI.</p>}
          {cli?.state === 'ok' && !cli.servers.length && <p className="py-4 text-12 text-text-muted">Nenhum servidor no Claude CLI.</p>}
          {cli?.servers.map((server, index) => <ServerItem key={server.key} index={`cli-${index}`} kind="cli" server={server} onOverview={setOverview} />)}
        </div>
      </Section>

      <Section title="Servidores do app">
        <SettingRow name="Adicionar servidor MCP" description={MCP_ADD_DESCRIPTION}>
          <Button action="mcp-add" variant="secondary" icon={Plus} disabled={form !== null} onClick={() => setForm(emptyForm())}>
            Adicionar servidor MCP
          </Button>
        </SettingRow>
        {form && (
          <ServerForm
            key={form.id ?? 'novo'}
            initial={form}
            onCancel={() => setForm(null)}
            onDone={(next) => {
              setOverview(next)
              setForm(null)
              // Salvo no Claude CLI: a lista de lá muda.
              if (!form.id && form.target === 'cli') refresh()
            }}
          />
        )}
        <div data-mcp-section="app" className="flex flex-col divide-y divide-line">
          {overview && !overview.app.length && <p className="py-4 text-12 text-text-muted">Nenhum servidor só deste app.</p>}
          {overview?.app.map((server, index) => <ServerItem key={server.key} index={`app-${index}`} kind="app" server={server} onOverview={setOverview} onEdit={() => setForm(formOf(server))} />)}
        </div>
      </Section>

      <Section title="Encontrados neste Mac">
        <SettingRow name="Claude Desktop" description={MCP_FOUND_DESCRIPTION}>
          <span data-mcp-found-count className="text-13 text-text-muted">
            {found.length === 0 ? 'Nada encontrado' : found.length === 1 ? '1 servidor' : `${found.length} servidores`}
          </span>
        </SettingRow>
        {found.length > 0 && (
          <div data-mcp-section="found" className="flex flex-col divide-y divide-line">
            {found.map((server) => (
              <FoundItem key={server.id} server={server} onOverview={setOverview} />
            ))}
          </div>
        )}
      </Section>

      <ConnectorsSection overview={overview} />
    </>
  )
}
