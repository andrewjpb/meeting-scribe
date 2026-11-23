import { Calendar, ChevronRight, Mail, Smartphone, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import type { InicioPendencias } from '@shared/inicio'
import { EMAIL_ROOT_PATH, ROUTE_PATHS } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { INICIO_CARTAO_CABECALHO_CLASS, INICIO_CARTAO_CLASS, INICIO_CARTAO_TITULO_CLASS, textoPendencia } from './inicioFormat'

type Fonte = keyof InicioPendencias

/** Cada fonte, na ordem da PRD (bloco 4): o ícone (o da barra lateral) e a tela que a linha abre (o convite não tem tela). */
const FONTES: readonly { fonte: Fonte; icone: LucideIcon; destino: string | null }[] = [
  { fonte: 'whatsapp', icone: Smartphone, destino: ROUTE_PATHS.whatsapp },
  { fonte: 'convites', icone: Calendar, destino: null },
  { fonte: 'emails', icone: Mail, destino: EMAIL_ROOT_PATH },
]

const LINHA_CLASS = 'flex h-8 items-center gap-2.5 text-13 text-text'

/**
 * Pendências (D8, artboard 01): uma linha por fonte, só quando há o que responder (`null` é a fonte desligada, zero é
 * nada pendente). Sem nenhuma linha, o cartão não aparece. As contagens chegam prontas do main.
 */
export function CartaoPendencias({ pendencias }: { pendencias: InicioPendencias | null }) {
  const linhas = FONTES.flatMap((item) => {
    const n = pendencias?.[item.fonte] ?? null
    return n !== null && n > 0 ? [{ ...item, n }] : []
  })
  if (linhas.length === 0) return null
  return (
    <section data-inicio-cartao="pendencias" aria-label="Pendências" className={INICIO_CARTAO_CLASS}>
      <header className={INICIO_CARTAO_CABECALHO_CLASS}>
        <h2 className={INICIO_CARTAO_TITULO_CLASS}>Pendências</h2>
      </header>
      <ul className="flex flex-col">
        {linhas.map(({ fonte, icone, destino, n }) => {
          const conteudo = (
            <>
              <Icon icon={icone} size={14} className="shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-bold text-title tabular">{n}</b> {textoPendencia[fonte](n)}
              </span>
              {destino && <Icon icon={ChevronRight} size={14} className="shrink-0 text-text-muted" />}
            </>
          )
          return (
            <li key={fonte} data-inicio-pendencia={fonte} className="flex flex-col border-b border-line last:border-b-0">
              {destino ? (
                <Link to={destino} draggable={false} className={`no-drag rounded-[var(--radius-control)] hover:text-title ${LINHA_CLASS}`}>
                  {conteudo}
                </Link>
              ) : (
                <p className={LINHA_CLASS}>{conteudo}</p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
