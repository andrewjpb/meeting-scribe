import { ChevronDown, Plus, X } from 'lucide-react'
import { useId, useState, type KeyboardEvent } from 'react'
import { CONTROL_CLASS } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { resultadosPicker, type PickerItem } from './funilFormat'

interface SearchPickerBase {
  /** Nome estável (`data-funil-picker="<nome>"`), para o smoke achar o campo. */
  nome: string
  /** Nome do campo para o leitor de tela (o rótulo visível fica com quem usa, ligado pelo `id`). */
  label: string
  id?: string | undefined
  placeholder?: string | undefined
  itens: readonly PickerItem[]
  /** Com ela, a última linha "Criar «texto»" (quando nenhum item tem exatamente esse nome). */
  onCriar?: ((texto: string) => void) | undefined
  disabled?: boolean | undefined
}

/** Um só (Empresa): o escolhido aparece no campo. Vários (Contatos): chips com "×" acima do campo. */
export type SearchPickerProps = SearchPickerBase &
  ({ multiplo?: false | undefined; valor: PickerItem | null; onChange: (item: PickerItem | null) => void } | { multiplo: true; valor: readonly PickerItem[]; onChange: (itens: PickerItem[]) => void })

type Opcao = { tipo: 'item'; item: PickerItem } | { tipo: 'criar'; texto: string }

const ROW = 'flex h-8 cursor-default items-center gap-2 px-2.5 text-13'

/**
 * Campo de busca com lista (contrato 112, R25, D21; usado também pelas telas 114, 116 e 119): com foco e texto, até 8
 * resultados logo abaixo do campo, em linhas de 32 px (setas escolhem, Enter confirma, Esc fecha) e, com `onCriar`, a
 * última linha "Criar «texto»". A lista fica no fluxo, abaixo do campo, para nunca ser cortada pela rolagem de quem usa.
 */
export function SearchPicker(props: SearchPickerProps) {
  const { nome, label, id, placeholder, itens, onCriar, disabled = false } = props
  const listId = useId()
  // `null`: o campo mostra o escolhido (modo único) ou fica vazio (vários); texto: a pessoa está buscando.
  const [texto, setTexto] = useState<string | null>(null)
  const [ativo, setAtivo] = useState(0)

  const escolhidos = props.multiplo ? props.valor.map((item) => item.id) : []
  const busca = texto ?? ''
  const resultado = resultadosPicker(itens, busca, escolhidos)
  const opcoes: Opcao[] = [...resultado.itens.map((item): Opcao => ({ tipo: 'item', item })), ...(onCriar && resultado.criar ? [{ tipo: 'criar', texto: busca.trim() } as const] : [])]
  // Só digitando há texto (o `blur`, a escolha e o Esc voltam a `null`): a lista aberta é a do campo com o foco.
  const aberto = texto !== null && busca.trim() !== '' && opcoes.length > 0
  const atual = Math.min(ativo, Math.max(0, opcoes.length - 1))

  const escolher = (opcao: Opcao): void => {
    setTexto(null)
    setAtivo(0)
    if (opcao.tipo === 'criar') {
      onCriar?.(opcao.texto)
      return
    }
    if (props.multiplo) props.onChange([...props.valor, opcao.item])
    else props.onChange(opcao.item)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!aberto) return
      event.preventDefault()
      const passo = event.key === 'ArrowDown' ? 1 : -1
      setAtivo((atual + passo + opcoes.length) % opcoes.length)
    } else if (event.key === 'Enter') {
      const opcao = opcoes[atual]
      if (!aberto || !opcao) return
      event.preventDefault()
      escolher(opcao)
    } else if (event.key === 'Escape') {
      // Só fecha a lista: o Esc não chega ao cartão (que cancelaria) nem à busca da tela.
      if (!aberto) return
      event.preventDefault()
      event.stopPropagation()
      setTexto(null)
    } else if (event.key === 'Backspace' && props.multiplo && !busca && props.valor.length) {
      props.onChange(props.valor.slice(0, -1))
    }
  }

  const input = (
    <input
      id={id}
      type="text"
      role="combobox"
      aria-label={label}
      aria-expanded={aberto}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={aberto ? `${listId}-${atual}` : undefined}
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      placeholder={placeholder}
      value={props.multiplo ? busca : (texto ?? props.valor?.nome ?? '')}
      onChange={(event) => {
        setTexto(event.target.value)
        setAtivo(0)
      }}
      onBlur={() => {
        // Modo único: apagar o texto e sair tira o escolhido; qualquer outro texto volta ao escolhido.
        if (!props.multiplo && texto !== null && !texto.trim() && props.valor) props.onChange(null)
        setTexto(null)
      }}
      onKeyDown={onKeyDown}
      className={
        props.multiplo
          ? 'h-6 min-w-[60px] flex-1 bg-transparent px-1.5 text-13 text-text select-text placeholder:text-text-faint focus-visible:outline-none'
          : `${CONTROL_CLASS} w-full min-w-0 pr-8 pl-2.5 select-text placeholder:text-text-faint`
      }
    />
  )

  return (
    <div data-funil-picker={nome} className="flex min-w-0 flex-col gap-1">
      {props.multiplo ? (
        <div className="no-drag flex min-h-8 min-w-0 flex-wrap items-center gap-1 rounded-[var(--radius-control)] border border-line-strong bg-bg-raised p-1 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus">
          {props.valor.map((item) => (
            <span key={item.id} data-funil-picker-chip={item.id} className={`inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-[var(--radius-control)] pr-1 pl-2 text-12 text-text ${item.novo ? 'bg-hl' : 'bg-bg-sunken'}`}>
              <span className="min-w-0 truncate">{item.nome}</span>
              <button
                type="button"
                aria-label={`Tirar ${item.nome}`}
                data-funil-picker-tirar={item.id}
                disabled={disabled}
                onClick={() => props.onChange(props.valor.filter((outro) => outro.id !== item.id))}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title"
              >
                <Icon icon={X} size={14} />
              </button>
            </span>
          ))}
          {input}
        </div>
      ) : (
        <div className="relative flex min-w-0">
          {input}
          <Icon icon={ChevronDown} className="pointer-events-none absolute top-2 right-2.5 text-text-muted" />
        </div>
      )}
      {aberto && (
        <ul id={listId} role="listbox" aria-label={label} className="flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line-strong bg-bg-raised py-0.5">
          {opcoes.map((opcao, index) => (
            <li
              key={opcao.tipo === 'item' ? opcao.item.id : 'criar'}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === atual}
              data-funil-picker-option={opcao.tipo === 'item' ? opcao.item.id : undefined}
              data-funil-picker-criar={opcao.tipo === 'criar' ? '' : undefined}
              // O foco fica no campo: o clique escolhe sem passar pelo `blur`.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setAtivo(index)}
              onClick={() => escolher(opcao)}
              className={`${ROW} ${index === atual ? 'bg-bg-sunken' : ''} ${opcao.tipo === 'criar' ? 'text-accent' : 'text-text'}`}
            >
              {opcao.tipo === 'criar' ? (
                <>
                  <Icon icon={Plus} className="shrink-0" />
                  <span className="min-w-0 truncate">Criar «{opcao.texto}»</span>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{opcao.item.nome}</span>
                  {opcao.item.detalhe && <span className="shrink-0 truncate text-12 text-text-muted">{opcao.item.detalhe}</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
