// Contrato 162: a barra da etiqueta, logo abaixo do cabeçalho da conversa aberta (pessoa ou grupo): o âmbito
// (Pessoal · Profissional · Nenhum), "Urgente" e "Triar agora". A escolha do dono prevalece sobre a do agente; nada
// daqui envia mensagem.
import { CircleAlert, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { TriagemAmbito } from '@shared/triagem'
import { Icon } from '../../design/Icon'
import { Segmented } from '../../design/Segmented'
import { TRIAGEM_RUN_ERRORS, TRIAGEM_TRIANDO_MAX_MS, useTriagem } from './triagemStore'

type AmbitoOpcao = TriagemAmbito | 'nenhum'

const AMBITO_OPCOES: readonly { value: AmbitoOpcao; label: string }[] = [
  { value: 'pessoal', label: 'Pessoal' },
  { value: 'profissional', label: 'Profissional' },
  { value: 'nenhum', label: 'Nenhum' },
]

const SET_FAILURE = 'Não foi possível gravar a etiqueta.'
const RUN_FAILURE = 'Não foi possível triar agora.'

const BUTTON_CLASS =
  'no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-13 font-medium transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] disabled:opacity-50'

export function EtiquetaBar({ chatId }: { chatId: string }) {
  const etiqueta = useTriagem((state) => state.etiquetas[chatId] ?? null)
  // Contrato 171 (C10): "Triando…" do clique até o fim da triagem no main (`triando`), não só até o pedido aceito.
  const [pedindo, setPedindo] = useState(false)
  const triando = useTriagem((state) => state.triando[chatId] === true)
  const running = pedindo || triando
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Sem o aviso do fim (janela recarregada, app bloqueado no meio), o "Triando…" cai sozinho.
  useEffect(() => {
    if (!triando) return
    const timer = setTimeout(() => useTriagem.getState().done(chatId), TRIAGEM_TRIANDO_MAX_MS)
    return () => clearTimeout(timer)
  }, [chatId, triando])

  const urgente = etiqueta?.urgente === true
  const ambito: AmbitoOpcao = etiqueta?.ambito ?? 'nenhum'

  const gravar = (patch: { urgente?: boolean; ambito?: TriagemAmbito | null }): void => {
    setError(null)
    void useTriagem
      .getState()
      .set(chatId, patch)
      .then((result) => {
        if (!result.ok && mounted.current) setError(SET_FAILURE)
      })
  }

  const triar = (): void => {
    if (running) return
    setPedindo(true)
    setError(null)
    void useTriagem
      .getState()
      .runNow(chatId)
      .then(
        (result) => {
          if (!mounted.current) return
          setPedindo(false)
          if (!result.ok) setError(TRIAGEM_RUN_ERRORS[result.error])
        },
        () => {
          if (!mounted.current) return
          setPedindo(false)
          setError(RUN_FAILURE)
        },
      )
  }

  return (
    <div data-triagem-bar className="flex min-h-11 shrink-0 items-center gap-2.5 border-b border-line px-5 py-1">
      <span id={`triagem-etiqueta-${chatId}`} className="text-12 text-text-muted">
        Etiqueta
      </span>
      <Segmented value={ambito} options={AMBITO_OPCOES} labelledBy={`triagem-etiqueta-${chatId}`} dataName="triagem-ambito" onChange={(next) => gravar({ ambito: next === 'nenhum' ? null : next })} />
      <button
        type="button"
        data-triagem-urgente
        aria-pressed={urgente}
        onClick={() => gravar({ urgente: !urgente })}
        className={`${BUTTON_CLASS} border ${urgente ? 'border-accent bg-accent text-on-accent' : 'border-line-strong bg-bg-raised text-title hover:bg-bg-sunken'}`}
      >
        <Icon icon={CircleAlert} size={14} />
        Urgente
      </button>
      <span className="min-w-0 flex-1">
        {error && (
          <span data-triagem-run-erro role="status" className="line-clamp-2 text-right text-12 leading-4 text-rec" title={error}>
            {error}
          </span>
        )}
      </span>
      <button type="button" data-triagem-run disabled={running} onClick={triar} className={`${BUTTON_CLASS} text-title hover:bg-bg-sunken`}>
        <Icon icon={Sparkles} size={14} />
        {running ? 'Triando…' : 'Triar agora'}
      </button>
    </div>
  )
}
