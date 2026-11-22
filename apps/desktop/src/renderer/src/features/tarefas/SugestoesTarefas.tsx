import { EyeOff, NotebookText, Plus, Smartphone, SquareCheck, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { SugestaoTarefa } from '@shared/tarefas'
import { ActionButton } from '../../design/ActionButton'
import { EmptyState } from '../../design/EmptyState'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { IlustracaoVazia, Vazio } from '../funil/ContatosScreen'
import { diaCurto, tarefaDaSugestao } from './tarefasFormat'
import { useTarefas } from './tarefasStore'

/** O dia (`AAAA-MM-DD`) de um instante, no fuso do Mac. */
function diaDe(at: number): string {
  const data = new Date(at)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

/** A segunda linha (artboard 06): "Reunião: <título> · do resumo", "Reunião: <título> · a confirmar" ou "WhatsApp: <conversa>". */
function textoDaOrigem(sugestao: SugestaoTarefa): string {
  const { origem } = sugestao
  if (origem.tipo === 'reuniao') return `Reunião: ${origem.titulo} · do resumo`
  if (origem.tipo === 'analise') return `Reunião: ${origem.titulo} · a confirmar`
  return `WhatsApp: ${origem.nome || 'conversa'}`
}

/**
 * Aba Sugestões da tela Tarefas (contrato 123, R26, artboard 06): uma linha de 44 px por candidata, com o ícone da fonte,
 * o texto, a origem, o prazo (ou a data) e "Adicionar" e "Ignorar". A linha some assim que a ação termina; a lista de
 * verdade volta do main a cada gravação das tarefas.
 */
export function SugestoesTarefas({ sugestoes, onFeita }: { sugestoes: readonly SugestaoTarefa[] | null; onFeita: (chave: string) => void }) {
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const agir = async (sugestao: SugestaoTarefa, acao: 'adicionar' | 'ignorar'): Promise<void> => {
    if (ocupada) return
    setOcupada(sugestao.chave)
    setErro(null)
    const store = useTarefas.getState()
    const result = acao === 'adicionar' ? await store.criar(tarefaDaSugestao(sugestao)) : await store.ignorar(sugestao.chave)
    setOcupada(null)
    if (result.ok) onFeita(sugestao.chave)
    else setErro(result.mensagem)
  }

  if (sugestoes === null) return null

  if (sugestoes.length === 0) {
    return (
      <Vazio marca="tarefas-sugestoes-vazia">
        <EmptyState illustration={<IlustracaoVazia icon={SquareCheck} />} title="Nenhuma sugestão agora">
          O que ficou com você nas reuniões e conversas dos últimos 30 dias aparece aqui.
        </EmptyState>
      </Vazio>
    )
  }

  return (
    <div data-tarefas-sugestoes className="min-h-0 flex-1 overflow-y-auto px-[var(--page-x)] pt-3 pb-5">
      <div className="max-w-[820px]">
        <div className="flex items-baseline justify-between gap-3 border-b border-line-strong pb-1.5">
          <h2 className="text-12 font-medium text-text-muted">Sugestões</h2>
          <p className="truncate text-12 font-medium text-text-muted">Das reuniões e conversas dos últimos 30 dias, só o que ficou com você</p>
        </div>
        {erro && (
          <Note
            id="tarefa-sugestao-erro"
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
          {sugestoes.map((sugestao) => (
            <li key={sugestao.chave} data-tarefa-sugestao={sugestao.chave} data-tarefa-sugestao-origem={sugestao.origem.tipo} className="flex min-h-11 items-center gap-3 border-b border-line px-2 py-1">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-bg-sunken text-text-muted">
                <Icon icon={sugestao.origem.tipo === 'whatsapp' ? Smartphone : NotebookText} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-13 font-medium text-title">{sugestao.texto}</span>
                <span className="truncate text-12 text-text-muted">{textoDaOrigem(sugestao)}</span>
              </div>
              <span className="shrink-0 text-12 whitespace-nowrap text-text-muted tabular">{sugestao.prazo ? `prazo ${diaCurto(sugestao.prazo)}` : `de ${diaCurto(diaDe(sugestao.em))}`}</span>
              <ActionButton icon={Plus} label="Adicionar" action="tarefa-sugestao-adicionar" disabled={ocupada !== null} onClick={() => void agir(sugestao, 'adicionar')} />
              <ActionButton icon={EyeOff} label="Ignorar" action="tarefa-sugestao-ignorar" disabled={ocupada !== null} onClick={() => void agir(sugestao, 'ignorar')} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-12 text-text-faint">Adicionar cria a tarefa com o prazo quando ele veio junto. Ignorar tira da lista e não volta.</p>
      </div>
    </div>
  )
}
