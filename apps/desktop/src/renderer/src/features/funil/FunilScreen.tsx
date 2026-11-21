import { Hourglass, TriangleAlert } from 'lucide-react'
import { Navigate, useParams } from 'react-router'
import { funilPath, isFunilSection, type FunilSection } from '@shared/routes'
import { EmptyState } from '../../design/EmptyState'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { useFunil, useFunilView } from './funilStore'
import { OportunidadesScreen } from './OportunidadesScreen'

/** O que ainda não tem tela (Contatos e Empresas no contrato 114; o detalhe da oportunidade no 119). */
const EM_PREPARACAO: Record<FunilSection, string> = {
  oportunidades: 'A página de cada oportunidade ainda está sendo preparada.',
  contatos: 'A lista de contatos ainda está sendo preparada.',
  empresas: 'A lista de empresas ainda está sendo preparada.',
}

/**
 * Funil de vendas (contrato 112, R17): `/funil/<secao>/<id>`. Sem seção (ou uma que não existe), Oportunidades;
 * Oportunidades sem id, o kanban. Carrega a view do funil ao montar e a acompanha enquanto a tela está aberta.
 */
export function FunilScreen() {
  const { secao, id } = useParams()
  const view = useFunilView()
  const error = useFunil((state) => state.error)

  if (!isFunilSection(secao)) return <Navigate to={funilPath('oportunidades')} replace />

  let content
  if (secao !== 'oportunidades' || id !== undefined) content = <EmPreparacao texto={EM_PREPARACAO[secao]} />
  else if (view) content = <OportunidadesScreen view={view} />
  else if (error)
    content = (
      <div className="px-[var(--page-x)] pt-[var(--page-top)]">
        <Note id="funil-load-failed" icon={TriangleAlert} role="alert">
          {error}
        </Note>
      </div>
    )

  return (
    <div data-funil-screen={secao} className="flex min-h-0 flex-1 flex-col">
      {content}
    </div>
  )
}

function EmPreparacao({ texto }: { texto: string }) {
  return (
    <div data-funil-em-preparacao className="flex flex-1 flex-col items-center px-[var(--page-x)]">
      <div className="grow-[3]" />
      <EmptyState
        illustration={
          <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-line-strong text-text-muted">
            <Icon icon={Hourglass} />
          </span>
        }
        title="Em preparação"
      >
        {texto}
      </EmptyState>
      <div className="grow-[7]" />
    </div>
  )
}
