// Formulário do agente de atendimento (contrato 142): nome, regras, tom, modelo e "Nunca diga ou prometa", e "Testar",
// que pergunta ao agente como está no formulário (sem salvar) o que ele faria com uma mensagem de exemplo. O teste não
// envia nada e não entra no histórico.
import { ArrowLeft, Bot, Play, TriangleAlert, UserRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  ATENDIMENTO_INSTRUCTIONS_MAX,
  ATENDIMENTO_MODELS,
  ATENDIMENTO_NAME_MAX,
  ATENDIMENTO_NEVER_MAX,
  ATENDIMENTO_TEST_MESSAGE_MAX,
  ATENDIMENTO_TONE_MAX,
  type AtendimentoAgentInput,
  type AtendimentoDecision,
  type AtendimentoModel,
} from '@shared/atendimento'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { Segmented } from '../../design/Segmented'
import { AREA_CLASS, FormField } from '../agents/parts'
import { QUIET_BUTTON } from '../chat/ChatMessages'
import { useAtendimento } from './atendimentoStore'
import { ATENDIMENTO_MODEL_LABELS } from './format'

const COUNT = new Intl.NumberFormat('pt-BR')
const SECONDS = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const MODEL_OPTIONS = ATENDIMENTO_MODELS.map((model) => ({ value: model, label: ATENDIMENTO_MODEL_LABELS[model] }))
const NOTHING_SENT = 'Nada é enviado. O teste não entra no histórico.'

export function blankAtendimentoAgent(): AtendimentoAgentInput {
  return { id: null, name: '', instructions: '', tone: '', never: '', model: 'haiku' }
}

/** Campo de várias linhas com o contador "N/máximo" à direita do rótulo. */
function CountedField({ label, htmlFor, count, max, hint, children }: { label: string; htmlFor: string; count: number; max: number; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" data-form-field={label}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-13 font-medium text-text">
          {label}
        </label>
        <span className="text-12 text-text-muted tabular" data-atendimento-count={htmlFor}>
          {COUNT.format(count)}/{COUNT.format(max)}
        </span>
      </div>
      {children}
      <p className="text-12 text-text-muted">{hint}</p>
    </div>
  )
}

type TestOutcome = { decision: AtendimentoDecision; ms: number; model: AtendimentoModel }

export function AtendimentoAgentForm({ initial, onClose }: { initial: AtendimentoAgentInput; onClose: () => void }) {
  const [agent, setAgent] = useState<AtendimentoAgentInput>(initial)
  const [failure, setFailure] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [testing, setTesting] = useState(false)
  const [outcome, setOutcome] = useState<TestOutcome | null>(null)
  const [testFailure, setTestFailure] = useState<string | null>(null)
  const patch = (next: Partial<AtendimentoAgentInput>): void => setAgent((current) => ({ ...current, ...next }))

  const tone = agent.tone ?? ''
  const never = agent.never ?? ''
  const valid = agent.name.trim() !== '' && agent.instructions.trim() !== ''

  const save = async (): Promise<void> => {
    setSaving(true)
    setFailure(null)
    const result = await useAtendimento.getState().saveAgent({ ...agent, name: agent.name.trim() })
    setSaving(false)
    if (!result.ok) setFailure(result.reason)
    else onClose()
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestFailure(null)
    setOutcome(null)
    const model = agent.model
    const result = await useAtendimento.getState().testAgent({ agent: { ...agent, name: agent.name.trim() || 'Agente sem nome' }, about: '', message: message.trim() })
    setTesting(false)
    if (result.ok) setOutcome({ decision: result.decision, ms: result.ms, model })
    else setTestFailure(result.reason)
  }

  return (
    <div data-atendimento-agent-form className="flex max-w-[760px] flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" data-action="atendimento-agent-back" aria-label="Voltar para Atendimento" onClick={onClose} className={QUIET_BUTTON}>
          <Icon icon={ArrowLeft} />
        </button>
        <h2 className="text-15 font-bold text-title">{initial.id ? 'Editar agente de atendimento' : 'Novo agente de atendimento'}</h2>
      </div>

      <FormField label="Nome" htmlFor="atendimento-agent-name">
        <TextField id="atendimento-agent-name" value={agent.name} onChange={(name) => patch({ name })} maxLength={ATENDIMENTO_NAME_MAX} placeholder="Ex.: Recados da Ana" />
      </FormField>

      <CountedField
        label="Regras"
        htmlFor="atendimento-agent-instructions"
        count={agent.instructions.length}
        max={ATENDIMENTO_INSTRUCTIONS_MAX}
        hint="O que o agente pode tratar e quando passa a conversa para você. Com criança ou adolescente na conversa, limite os assuntos e mande passar para você em tema sensível."
      >
        <textarea id="atendimento-agent-instructions" rows={6} value={agent.instructions} maxLength={ATENDIMENTO_INSTRUCTIONS_MAX} onChange={(event) => patch({ instructions: event.target.value })} className={AREA_CLASS} />
      </CountedField>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        <FormField label="Tom" htmlFor="atendimento-agent-tone" hint="Como ele escreve.">
          <TextField id="atendimento-agent-tone" value={tone} onChange={(next) => patch({ tone: next })} maxLength={ATENDIMENTO_TONE_MAX} placeholder="Ex.: Carinhoso e curto, sem gírias" />
        </FormField>
        <FormField label="Modelo" labelId="atendimento-agent-model" hint="Haiku responde mais rápido. Sonnet entende melhor conversas longas.">
          <div className="flex">
            <Segmented value={agent.model} options={MODEL_OPTIONS} labelledBy="atendimento-agent-model" dataName="atendimento-agent-model-option" onChange={(model) => patch({ model })} />
          </div>
        </FormField>
      </div>

      <CountedField label="Nunca diga ou prometa" htmlFor="atendimento-agent-never" count={never.length} max={ATENDIMENTO_NEVER_MAX} hint="Vale acima das regras. Perguntado se é um robô, o agente sempre passa para você.">
        <textarea id="atendimento-agent-never" rows={3} value={never} maxLength={ATENDIMENTO_NEVER_MAX} onChange={(event) => patch({ never: event.target.value })} className={AREA_CLASS} />
      </CountedField>

      {failure && (
        <Note id="atendimento-agent-form-error" icon={TriangleAlert} role="alert">
          {failure}
        </Note>
      )}
      <div className="flex items-center gap-2">
        <Button action="atendimento-agent-save" onClick={() => void save()} disabled={!valid || saving}>
          Salvar
        </Button>
        <Button action="atendimento-agent-cancel" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </div>

      <section aria-label="Testar" data-atendimento-test className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-14 leading-5 font-semibold text-title">Testar</h3>
        <p className="text-12 text-text-muted">Escreva uma mensagem de exemplo e veja a resposta que o agente daria, com as regras como estão no formulário.</p>
        <div className="flex items-center gap-2">
          <TextField
            id="atendimento-agent-test-message"
            ariaLabel="Mensagem de exemplo"
            value={message}
            onChange={setMessage}
            onEnter={() => {
              if (message.trim() && agent.instructions.trim() && !testing) void runTest()
            }}
            maxLength={ATENDIMENTO_TEST_MESSAGE_MAX}
            placeholder="Ex.: Pai, esqueci a chave. Você chega que horas?"
          />
          <Button action="atendimento-agent-test" variant="secondary" icon={Play} onClick={() => void runTest()} disabled={!message.trim() || !agent.instructions.trim() || testing}>
            {testing ? 'Testando…' : 'Testar'}
          </Button>
        </div>
        {testFailure && (
          <Note id="atendimento-agent-test-error" icon={TriangleAlert} role="alert">
            {testFailure}
          </Note>
        )}
        {outcome ? (
          <div data-atendimento-test-result={outcome.decision.acao} aria-live="polite" className="flex flex-col gap-2 border-l-3 border-title bg-bg-sunken px-3 py-2">
            <div className="flex items-center justify-between gap-3 text-12">
              <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                <Icon icon={outcome.decision.acao === 'responder' ? Bot : UserRound} />
                {outcome.decision.acao === 'responder' ? 'Responderia' : 'Passaria para você'}
              </span>
              <span className="text-text-muted tabular">
                {ATENDIMENTO_MODEL_LABELS[outcome.model]} · {SECONDS.format(outcome.ms / 1000)} s
              </span>
            </div>
            <p className="text-13 whitespace-pre-wrap text-text select-text">{outcome.decision.acao === 'responder' ? outcome.decision.texto : outcome.decision.motivo}</p>
            <p className="text-12 text-text-muted">{NOTHING_SENT}</p>
          </div>
        ) : (
          <p className="text-12 text-text-muted">{NOTHING_SENT}</p>
        )}
      </section>
    </div>
  )
}
