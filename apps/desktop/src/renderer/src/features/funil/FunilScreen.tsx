import { TriangleAlert } from 'lucide-react'
import { Navigate, useParams } from 'react-router'
import { funilPath, isFunilSection } from '@shared/routes'
import { Note } from '../../design/Note'
import { ContatosScreen } from './ContatosScreen'
import { EmpresasScreen } from './EmpresasScreen'
import { useFunil, useFunilView } from './funilStore'
import { OportunidadeScreen } from './OportunidadeScreen'
import { OportunidadesScreen } from './OportunidadesScreen'

/**
 * Funil de vendas (contrato 112, R17): `/funil/<secao>/<id>`. Sem seção (ou uma que não existe), Oportunidades;
 * Oportunidades sem id, o kanban; com id, o detalhe da oportunidade (contrato 119). Contatos e Empresas (contrato 114):
 * a lista com a ficha do id (sem id, a do primeiro da lista). Carrega a view do funil ao montar e a acompanha enquanto a
 * tela está aberta.
 */
export function FunilScreen() {
  const { secao, id } = useParams()
  const view = useFunilView()
  const error = useFunil((state) => state.error)

  if (!isFunilSection(secao)) return <Navigate to={funilPath('oportunidades')} replace />

  let content
  if (view && secao === 'contatos') content = <ContatosScreen view={view} id={id} />
  else if (view && secao === 'empresas') content = <EmpresasScreen view={view} id={id} />
  else if (view && id !== undefined) content = <OportunidadeScreen key={id} view={view} id={id} />
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
