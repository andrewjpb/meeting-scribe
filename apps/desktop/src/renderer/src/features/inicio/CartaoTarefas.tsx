import { Check } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { TAREFAS_ROOT_PATH, tarefasPath } from '@shared/routes'
import { particao } from '@shared/tarefas-logic'
import { Icon } from '../../design/Icon'
import { CaixaFeito } from '../tarefas/TarefaLinha'
import { textoOrigem } from '../tarefas/tarefasFormat'
import { useTarefasView } from '../tarefas/tarefasStore'
import { INICIO_CARTAO_CABECALHO_CLASS, INICIO_CARTAO_CLASS, INICIO_CARTAO_TITULO_CLASS, INICIO_LINK_CLASS } from './inicioFormat'

/** Quantas tarefas de hoje o cartão mostra (PRD, bloco 3). */
export const INICIO_TAREFAS_MAX = 6

/**
 * Tarefas (D9, artboard 01): o número de vencidas em --rec no cabeçalho e até 6 tarefas de Hoje, com a mesma caixa de
 * feito da tela Tarefas (escolha D3: quadrada, 16 px). Concluir passa pelo canal de sempre (`useTarefas.status`); a linha
 * sai quando a view nova chega. O título abre a tarefa; "Abrir Tarefas" abre a lista.
 */
export function CartaoTarefas() {
  const view = useTarefasView()
  const [erro, setErro] = useState<string | null>(null)
  if (!view) return null
  const { vencidas, hoje } = particao(view.tarefas, view.hoje)
  const linhas = hoje.slice(0, INICIO_TAREFAS_MAX)
  return (
    <section data-inicio-cartao="tarefas" aria-label="Tarefas" className={INICIO_CARTAO_CLASS}>
      <header className={INICIO_CARTAO_CABECALHO_CLASS}>
        <h2 className={INICIO_CARTAO_TITULO_CLASS}>Tarefas</h2>
        {vencidas.length > 0 && (
          <span data-inicio-vencidas={vencidas.length} className="inline-flex items-center gap-1.5 text-12 font-medium text-rec tabular">
            <span aria-hidden="true" className="size-1.5 shrink-0 bg-rec" />
            {vencidas.length === 1 ? '1 vencida' : `${vencidas.length} vencidas`}
          </span>
        )}
        <span className="flex-1" />
        <Link to={TAREFAS_ROOT_PATH} draggable={false} data-inicio-abrir="tarefas" className={INICIO_LINK_CLASS}>
          Abrir Tarefas
        </Link>
      </header>
      {linhas.length > 0 ? (
        <ul className="flex flex-col">
          {linhas.map((tarefa) => {
            const origem = textoOrigem(tarefa, view.nomes)
            return (
              <li key={tarefa.id} data-inicio-tarefa={tarefa.id} className="flex h-8 items-center gap-2.5 border-b border-line last:border-b-0">
                <CaixaFeito tarefa={tarefa} data={{ 'data-inicio-tarefa-feito': '' }} onErro={setErro} />
                <Link to={tarefasPath(tarefa.id)} draggable={false} className="no-drag min-w-0 flex-1 truncate rounded-[var(--radius-control)] text-13 font-medium text-title">
                  {tarefa.titulo}
                </Link>
                <span className="w-24 shrink-0 truncate text-right text-12 text-text-muted">{origem.icone === 'manual' ? '' : origem.nome}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="flex h-8 items-center gap-2 text-13 text-text-muted">
          <Icon icon={Check} size={14} className="shrink-0 text-text-faint" />
          {vencidas.length > 0 ? 'Nada para hoje.' : 'Nada para hoje e nenhuma vencida.'}
        </p>
      )}
      {erro && (
        <p role="alert" className="mt-1 text-12 text-rec">
          {erro}
        </p>
      )}
    </section>
  )
}
