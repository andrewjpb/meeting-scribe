import { useEffect, useId, useRef, useState } from 'react'
import type { Etapa, FunilState } from '@shared/funil'
import { Button } from '../../design/Button'
import { CONTROL_CLASS, TextField } from '../../design/Field'
import { CANCELAR_CLASS, CARD_CLASS } from './KanbanCard'
import { oportunidadeAbertaDaEmpresa, parseValor, type PickerItem } from './funilFormat'
import { useFunil } from './funilStore'
import { SearchPicker } from './SearchPicker'

const LABEL = 'text-12 text-text-muted'
/** O título no aviso de duplicata: link como o das notas, mas que quebra a linha (o cartão é estreito). */
const LINK_CLASS = 'no-drag rounded-[var(--radius-control)] text-left font-medium text-accent underline decoration-1 underline-offset-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'

interface NovaOportunidadeCardProps {
  state: FunilState
  /** A primeira etapa aberta: onde o cartão está e onde a oportunidade nasce (R25). */
  etapa: Etapa
  /** Preenchido pela navegação (`FunilNavigationState.nova`). */
  inicial: { contatoIds: string[]; empresaId: string | null }
  onFechar: () => void
  /** O link do aviso de duplicata: a oportunidade aberta da empresa. */
  onAbrir: (id: string) => void
}

/**
 * "Nova oportunidade" no topo da primeira coluna aberta (contrato 112, R25, artboard 02): Título (obrigatório, com o
 * foco), Empresa e Contatos pelo `SearchPicker`, Valor em reais e Previsão. Empresa com oportunidade aberta mostra o
 * aviso de duplicata, sem impedir "Criar". Esc ou "Cancelar" fecham sem gravar nada.
 */
export function NovaOportunidadeCard({ state, etapa, inicial, onFechar, onAbrir }: NovaOportunidadeCardProps) {
  const ids = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [titulo, setTitulo] = useState('')
  const [empresa, setEmpresa] = useState<PickerItem | null>(() => {
    const achada = state.empresas.find((item) => item.id === inicial.empresaId)
    return achada ? { id: achada.id, nome: achada.nome } : null
  })
  const [contatos, setContatos] = useState<PickerItem[]>(() => state.contatos.filter((contato) => inicial.contatoIds.includes(contato.id)).map((contato) => ({ id: contato.id, nome: contato.nome })))
  const [valor, setValor] = useState('')
  const [previsao, setPrevisao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('[data-funil-nova-titulo]')?.focus()
  }, [])

  const empresas: PickerItem[] = state.empresas.map((item) => ({ id: item.id, nome: item.nome, detalhe: item.dominios[0] }))
  const pessoas: PickerItem[] = state.contatos.filter((contato) => !contato.arquivado).map((contato) => ({ id: contato.id, nome: contato.nome, detalhe: contato.emails[0] }))
  const duplicata = oportunidadeAbertaDaEmpresa(state, empresa?.id ?? null)

  const criarEmpresa = async (nome: string): Promise<void> => {
    setErro(null)
    const result = await useFunil.getState().saveEmpresa({ nome, dominios: [] })
    if (result.ok && result.id) setEmpresa({ id: result.id, nome })
    else if (!result.ok) setErro(result.mensagem)
  }

  const criar = async (): Promise<void> => {
    if (!titulo.trim() || salvando) return
    const centavos = valor.trim() ? parseValor(valor) : null
    if (valor.trim() && centavos === null) {
      setErro('Valor fora do formato. Use, por exemplo, 1.234,56.')
      return
    }
    setSalvando(true)
    setErro(null)
    const result = await useFunil.getState().saveOportunidade({
      titulo: titulo.trim(),
      empresaId: empresa?.id ?? null,
      contatoIds: contatos.map((contato) => contato.id),
      etapaId: etapa.id,
      valor: centavos,
      previsao: previsao || null,
    })
    setSalvando(false)
    if (result.ok) onFechar()
    else setErro(result.mensagem)
  }

  return (
    <div
      ref={ref}
      data-funil-card-novo=""
      className={`${CARD_CLASS} gap-1.5 border-accent`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        onFechar()
      }}
    >
      <label htmlFor={`${ids}-titulo`} className={LABEL}>
        Título
      </label>
      <div className="flex">
        <TextField id={`${ids}-titulo`} value={titulo} onChange={setTitulo} onEnter={() => void criar()} maxLength={200} disabled={salvando} data={{ 'data-funil-nova-titulo': '' }} />
      </div>
      <label htmlFor={`${ids}-empresa`} className={LABEL}>
        Empresa
      </label>
      <SearchPicker nome="empresa" id={`${ids}-empresa`} label="Empresa" placeholder="Escolher ou criar…" itens={empresas} valor={empresa} onChange={setEmpresa} onCriar={(nome) => void criarEmpresa(nome)} disabled={salvando} />
      {duplicata && (
        <p data-funil-aviso-duplicata="" role="status" className="text-12 text-pretty text-text-muted">
          Já existe «
          <button type="button" data-action="funil-aviso-duplicata-abrir" className={LINK_CLASS} onClick={() => onAbrir(duplicata.id)}>
            {duplicata.titulo}
          </button>
          » aberta para esta empresa
        </p>
      )}
      <label htmlFor={`${ids}-contatos`} className={LABEL}>
        Contatos
      </label>
      <SearchPicker multiplo nome="contatos" id={`${ids}-contatos`} label="Contatos" placeholder="Buscar" itens={pessoas} valor={contatos} onChange={setContatos} disabled={salvando} />
      {/* Valor e Previsão lado a lado quando cabem; na coluna mais estreita, a data desce para a linha de baixo. */}
      <div className="flex flex-wrap gap-x-2 gap-y-1.5">
        <div className="flex min-w-0 flex-[1_1_64px] flex-col gap-1.5">
          <label htmlFor={`${ids}-valor`} className={LABEL}>
            Valor (R$)
          </label>
          <div className="flex">
            <TextField id={`${ids}-valor`} value={valor} onChange={setValor} onEnter={() => void criar()} maxLength={20} disabled={salvando} data={{ 'data-funil-nova-valor': '' }} />
          </div>
        </div>
        <div className="flex min-w-0 flex-[1_1_116px] flex-col gap-1.5">
          <label htmlFor={`${ids}-previsao`} className={LABEL}>
            Previsão
          </label>
          <input
            id={`${ids}-previsao`}
            type="date"
            data-funil-nova-previsao=""
            value={previsao}
            disabled={salvando}
            onChange={(event) => setPrevisao(event.target.value)}
            className={`${CONTROL_CLASS} w-full min-w-0 px-2 select-text`}
          />
        </div>
      </div>
      {erro && (
        <p role="alert" data-funil-nova-erro="" className="text-12 text-pretty text-rec">
          {erro}
        </p>
      )}
      <div className="mt-1 flex items-center gap-1">
        <Button action="funil-nova-criar" onClick={() => void criar()} disabled={!titulo.trim() || salvando}>
          Criar
        </Button>
        <button type="button" data-action="funil-nova-cancelar" onClick={onFechar} disabled={salvando} className={CANCELAR_CLASS}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
