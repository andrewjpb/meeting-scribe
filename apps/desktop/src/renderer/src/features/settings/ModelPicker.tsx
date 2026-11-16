import { Check, KeyRound, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { CatalogError, CatalogModel, ModelCheck } from '@shared/assemblyai'
import { settingsPath, TRANSCRIPTION_ANCHOR, type SettingsNavigationState } from '@shared/routes'
import { useSettings } from '../../app/settingsStore'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { RetryNotice } from '../live/Notices'
import { API_KEY_INPUT_ID } from './ApiKeyField'
import { useApiKey } from './keyStore'
import { countLabel, filterModels, formatContext, formatPrice } from './modelFormat'
import { useModels } from './modelsStore'

const SKELETON_ROWS = 6

const CATALOG_ERROR: Record<Exclude<CatalogError, 'no-key'>, string> = {
  network: 'Não foi possível carregar a lista de modelos. Confira a conexão.',
  refused: 'A AssemblyAI recusou a chave ao listar os modelos.',
  server: 'Não foi possível carregar a lista de modelos.',
}

const SELECT_ERROR: Partial<Record<ModelCheck, string>> = {
  network: 'Não foi possível conferir o modelo agora. A escolha anterior continua.',
  server: 'A AssemblyAI não conseguiu conferir o modelo. A escolha anterior continua.',
  refused: 'A AssemblyAI recusou a chave. Confira a chave em Transcrição.',
  'no-key': 'Adicione a chave da AssemblyAI para escolher o modelo.',
}

/**
 * Painel do modelo de tradução: busca por nome ou id, lista com preço e contexto, marca no modelo atual.
 * Escolher confere no gateway se o modelo está liberado na conta antes de gravar.
 */
export function ModelPicker() {
  const configured = useApiKey((state) => state.status?.configured ?? null)
  const last4 = useApiKey((state) => state.status?.last4 ?? null)
  const catalog = useModels((state) => state.catalog)
  const current = useSettings((state) => state.settings.translationModel)

  // Chave trocada, removida ou adicionada: lista de novo.
  useEffect(() => {
    if (configured) void useModels.getState().load()
  }, [configured, last4])

  let body
  if (configured === false) body = <NoKey />
  else if (catalog.phase === 'error') body = catalog.error === 'no-key' ? <NoKey /> : <CatalogFailure error={catalog.error} current={current} />
  else if (catalog.phase === 'ready') body = <ModelList models={catalog.models} current={current} />
  else body = <Skeleton />

  return (
    <div data-model-picker={configured === false ? 'no-key' : catalog.phase} className="flex flex-col">
      {body}
      <p className="mt-2.5 text-12 text-text-muted">
        Preço de entrada e de saída por 1 milhão de tokens. Ao escolher, o app confere se o modelo está liberado na sua conta.
      </p>
    </div>
  )
}

function CurrentModel({ current }: { current: string }) {
  return (
    <p className="mt-3 text-12 text-text-muted" data-current-model={current}>
      Modelo atual: <span className="font-mono text-11 text-text">{current}</span>
    </p>
  )
}

function NoKey() {
  const current = useSettings((state) => state.settings.translationModel)
  const navigate = useNavigate()
  // A chave fica na aba "Gravação" (contrato 18): a tela troca de aba, rola até o bloco e foca o campo.
  const addKey = (): void => {
    const state: SettingsNavigationState = { focus: API_KEY_INPUT_ID }
    void navigate(settingsPath('gravacao', TRANSCRIPTION_ANCHOR), { state })
  }
  return (
    <div>
      <Note
        id="model-no-key"
        icon={KeyRound}
        action={
          <button type="button" className={NOTE_ACTION_CLASS} onClick={addKey}>
            Adicionar chave
          </button>
        }
      >
        Adicione a chave da AssemblyAI para ver os modelos e os preços.
      </Note>
      <CurrentModel current={current} />
    </div>
  )
}

function CatalogFailure({ error, current }: { error: Exclude<CatalogError, 'no-key'>; current: string }) {
  return (
    <div>
      <RetryNotice id="models-load-failed" text={CATALOG_ERROR[error]} onRetry={() => void useModels.getState().load()} />
      <CurrentModel current={current} />
    </div>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong">{children}</div>
}

function Skeleton() {
  return (
    <Panel>
      <div className="flex h-11 items-center gap-2.5 border-b border-line-strong bg-bg-sunken px-3">
        <Icon icon={Search} className="text-text-muted" />
        <span className="text-13 text-text-faint">Carregando modelos…</span>
      </div>
      <div aria-hidden="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="flex min-h-14 items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
            <span className="w-[16px]" />
            <span className="flex flex-[1_1_200px] flex-col gap-1.5">
              <span className="h-3 w-40 rounded-[2px] bg-bg-sunken" />
              <span className="h-2.5 w-28 rounded-[2px] bg-bg-sunken" />
            </span>
            <span className="h-3 w-36 rounded-[2px] bg-bg-sunken" />
          </div>
        ))}
      </div>
    </Panel>
  )
}

function ModelList({ models, current }: { models: CatalogModel[]; current: string }) {
  const [query, setQuery] = useState('')
  const notAllowed = useModels((state) => state.notAllowed)
  const checking = useModels((state) => state.checking)
  const selectFailure = useModels((state) => state.selectFailure)
  const select = useModels((state) => state.select)

  // O modelo atual fora do catálogo (retirado, por exemplo) continua visível pelo id.
  const all = useMemo(
    () => (models.some((model) => model.id === current) ? models : [{ id: current, name: current, contextLength: null, promptPerM: null, completionPerM: null }, ...models]),
    [models, current],
  )
  const shown = useMemo(() => filterModels(all, query), [all, query])
  const failureText = selectFailure ? SELECT_ERROR[selectFailure.check] : undefined

  return (
    <div className="flex flex-col">
      <Panel>
        <div className="flex items-center gap-2.5 border-b border-line-strong bg-bg-sunken px-3">
          <Icon icon={Search} className="shrink-0 text-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Buscar modelo"
            placeholder="Buscar por nome ou id"
            autoComplete="off"
            spellCheck={false}
            data-model-search
            className="no-drag h-11 min-w-0 grow border-0 bg-transparent text-13 text-text select-text placeholder:text-text-faint focus-visible:outline-offset-[-2px]"
          />
          <span className="shrink-0 text-12 text-text-muted tabular" aria-live="polite">
            {countLabel(shown.length, all.length)}
          </span>
        </div>
        <div className="max-h-[336px] overflow-y-auto" role="group" aria-label="Modelos de tradução">
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-13 text-text-muted">Nenhum modelo com esse nome ou id.</p>
          ) : (
            shown.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                selected={model.id === current}
                blocked={notAllowed.has(model.id)}
                checking={checking === model.id}
                busy={checking !== null}
                onSelect={() => void select(model.id)}
              />
            ))
          )}
        </div>
      </Panel>
      {selectFailure && failureText && (
        <RetryNotice
          id="model-select-failed"
          text={`${failureText} (${selectFailure.id})`}
          onRetry={() => void select(selectFailure.id)}
          className="mt-3"
        />
      )}
    </div>
  )
}

interface ModelRowProps {
  model: CatalogModel
  selected: boolean
  blocked: boolean
  checking: boolean
  busy: boolean
  onSelect: () => void
}

function ModelRow({ model, selected, blocked, checking, busy, onSelect }: ModelRowProps) {
  const tone = blocked ? 'bg-bg-sunken text-text-muted cursor-not-allowed' : 'bg-bg-raised text-text hover:bg-bg-sunken'
  let price = <span className="text-12 tabular">{formatPrice(model)}</span>
  if (blocked) price = <span className="text-12 font-medium">Não liberado na sua conta</span>
  else if (checking) price = <span className="text-12 text-text-muted">Conferindo…</span>
  return (
    <button
      type="button"
      data-model={model.id}
      data-model-state={blocked ? 'not-allowed' : selected ? 'selected' : checking ? 'checking' : 'available'}
      aria-pressed={selected}
      aria-disabled={blocked || (busy && !checking) ? true : undefined}
      onClick={() => {
        if (!blocked && !busy) onSelect()
      }}
      className={`no-drag flex min-h-14 w-full flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-left text-13 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] last:border-b-0 focus-visible:outline-offset-[-2px] ${tone}`}
    >
      {selected ? <Check size={16} strokeWidth={2} strokeLinecap="square" aria-hidden="true" className="shrink-0 text-accent" /> : <span aria-hidden="true" className="w-[16px] shrink-0" />}
      <span className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <span className="font-medium">{model.name}</span>
        <span className={`font-mono text-11 ${blocked ? '' : 'text-text-muted'}`}>{model.id}</span>
      </span>
      {price}
      <span className={`flex-[0_0_40px] text-right text-12 tabular ${blocked ? '' : 'text-text-muted'}`}>{formatContext(model.contextLength)}</span>
    </button>
  )
}
