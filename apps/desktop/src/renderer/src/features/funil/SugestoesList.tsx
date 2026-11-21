import { EyeOff, Mail, NotebookText, Smartphone, TriangleAlert, UserPlus, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Sugestao, SugestaoCanal } from '@shared/funil'
import { ActionButton } from '../../design/ActionButton'
import { EmptyState } from '../../design/EmptyState'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { canalDaSugestao, textoSugestao } from './funilFormat'
import { useFunil } from './funilStore'

/** O ícone do canal principal (R33); a agenda não é fonte (R11). */
const CANAL_ICONE: Record<SugestaoCanal, LucideIcon> = { reuniao: NotebookText, email: Mail, whatsapp: Smartphone }

/**
 * Aba Sugestões de Contatos (contrato 114, R11, R12, R33, artboard 06), em largura total: uma linha de 44 px por pessoa
 * que apareceu em reuniões, e-mails e conversas, com "Adicionar" (cria o contato com a origem do canal) e "Ignorar"
 * (tira a pessoa da lista de vez). A linha some assim que a ação termina; a lista de verdade volta do main a cada gravação.
 */
export function SugestoesList({ sugestoes, onFeita }: { sugestoes: readonly Sugestao[] | null; onFeita: (chave: string) => void }) {
  const [now, setNow] = useState(() => Date.now())
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const adicionar = async (sugestao: Sugestao): Promise<void> => {
    if (ocupada) return
    setOcupada(sugestao.chave)
    setErro(null)
    const result = await useFunil.getState().saveContato(
      {
        nome: sugestao.nome.trim() || sugestao.email || sugestao.telefone || 'Sem nome',
        emails: sugestao.email ? [sugestao.email] : [],
        telefones: sugestao.telefone ? [sugestao.telefone] : [],
        ...(sugestao.whatsappChatId ? { whatsappChatId: sugestao.whatsappChatId } : {}),
      },
      sugestao.origem,
    )
    setOcupada(null)
    if (result.ok) onFeita(sugestao.chave)
    else setErro(result.mensagem)
  }

  const ignorar = async (sugestao: Sugestao): Promise<void> => {
    if (ocupada) return
    setOcupada(sugestao.chave)
    setErro(null)
    const result = await useFunil.getState().ignorar(sugestao.chave)
    setOcupada(null)
    if (result.ok) onFeita(sugestao.chave)
    else setErro(result.mensagem)
  }

  if (sugestoes === null) return null

  if (sugestoes.length === 0) {
    return (
      <div data-funil-sugestoes-vazia className="flex flex-1 flex-col items-center px-[var(--page-x)]">
        <div className="grow-[3]" />
        <EmptyState
          illustration={
            <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-line-strong text-text-muted">
              <Icon icon={Users} />
            </span>
          }
          title="Nenhuma sugestão."
        >
          Reuniões, e-mails e conversas novas aparecem aqui.
        </EmptyState>
        <div className="grow-[7]" />
      </div>
    )
  }

  return (
    <div data-funil-sugestoes className="min-h-0 flex-1 overflow-y-auto px-[var(--page-x)] pt-4 pb-5">
      <div className="flex items-baseline justify-between gap-3 border-b border-line-strong pb-1.5">
        <h2 className="text-12 font-medium text-text-muted">Sugestões</h2>
        <p className="truncate text-12 font-medium text-text-muted">De reuniões, e-mails e conversas dos últimos 90 dias</p>
      </div>
      {erro && (
        <Note
          id="funil-sugestao-erro"
          icon={TriangleAlert}
          role="alert"
          className="mt-3"
          action={
            <button type="button" className={`${NOTE_ACTION_CLASS} text-13`} onClick={() => setErro(null)}>
              Fechar
            </button>
          }
        >
          {erro}
        </Note>
      )}
      <ul className="flex flex-col">
        {sugestoes.map((sugestao) => {
          const textos = textoSugestao(sugestao, now)
          const canal = canalDaSugestao(sugestao)
          return (
            <li key={sugestao.chave} data-funil-sugestao={sugestao.chave} data-funil-sugestao-canal={canal} className="flex h-11 items-center gap-3 border-b border-line">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-text-muted">
                <Icon icon={CANAL_ICONE[canal]} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-13 font-semibold text-title">{sugestao.nome.trim() || sugestao.email || sugestao.telefone}</span>
                <span className="truncate text-12 text-text-muted tabular">{textos.contato}</span>
              </div>
              <span className="shrink-0 text-12 text-text-muted tabular">{textos.interacoes}</span>
              <ActionButton icon={UserPlus} label="Adicionar" action="funil-sugestao-adicionar" disabled={ocupada !== null} onClick={() => void adicionar(sugestao)} />
              <ActionButton icon={EyeOff} label="Ignorar" action="funil-sugestao-ignorar" disabled={ocupada !== null} onClick={() => void ignorar(sugestao)} />
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-12 text-text-muted">Adicionar cria o contato com a origem do canal. Ignorar tira a pessoa desta lista de vez.</p>
    </div>
  )
}
