import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { FUNIL_TRANSPORTE_TEXTO, type ContatoOrigem, type FunilView } from '@shared/funil'
import { contatoLigado, semAcento, type ContatoAlvo } from '@shared/funil-logic'
import { funilPath } from '@shared/routes'
import { rereadWhenUnlocked } from '../../app/lockStore'
import { ActionButton } from '../../design/ActionButton'
import { useFunil } from './funilStore'
import { FUNIL_LINK_CLASS } from './Timeline'

// Contrato 159: `contatoLigado` e `ContatoAlvo` moram em `shared/funil-logic.ts`; ficam exportados daqui para quem já os
// importava deste arquivo.
export { contatoLigado, type ContatoAlvo }

/** Os dois nomes são o mesmo (contrato 131, R5): sem acento, sem caixa, sem espaço nas pontas e com espaços simples. */
export function mesmoNome(a: string, b: string): boolean {
  const chave = (nome: string): string => semAcento(nome).trim().replace(/\s+/g, ' ').toLowerCase()
  return chave(a) === chave(b)
}

// Várias telas montam vários `ContactLink` de uma vez (um por participante): uma carga e uma assinatura só para todos.
let usuarios = 0
let parar: (() => void) | null = null
let releitura: (() => void) | null = null
let nova: ReturnType<typeof setTimeout> | null = null
/** Depois de uma falha de `scribe:funil-get` (fora do bloqueio), uma tentativa a mais, passado este tempo. */
const NOVA_TENTATIVA_MS = 2000

/** Lê a view do funil; recusada com o app bloqueado, relê no desbloqueio; outra falha tenta de novo uma vez. */
function carregar(tentarDeNovo: boolean): void {
  const falhou = (mensagem: string): void => {
    useFunil.setState({ error: mensagem })
    if (tentarDeNovo && usuarios > 0) nova = setTimeout(() => carregar(false), NOVA_TENTATIVA_MS)
  }
  window.__scribeApi.invoke('scribe:funil-get').then(
    (result) => {
      if ('ok' in result) falhou(result.mensagem)
      else useFunil.setState({ view: result, error: null })
    },
    (error: unknown) => {
      if (usuarios === 0) return
      releitura = rereadWhenUnlocked(error, () => carregar(true))
      if (!releitura) falhou(FUNIL_TRANSPORTE_TEXTO)
    },
  )
}

/**
 * A view do funil para as telas fora do funil (Resumo, Email, WhatsApp): carrega na primeira montagem e acompanha. Com o
 * app bloqueado, relê no desbloqueio; depois de outra falha, tenta mais uma vez (e de novo na próxima montagem).
 */
export function useFunilCompartilhado(): FunilView | null {
  const view = useFunil((state) => state.view)
  useEffect(() => {
    usuarios += 1
    if (usuarios === 1) {
      parar = useFunil.getState().watch()
      carregar(true)
    }
    return () => {
      usuarios -= 1
      if (usuarios === 0) {
        parar?.()
        parar = null
        releitura?.()
        releitura = null
        if (nova) clearTimeout(nova)
        nova = null
      }
    }
  }, [])
  return view
}

/** O funil não carregou (a leitura falhou): o texto da falha; `null` com a view à mão ou ainda carregando. */
export function useFunilIndisponivel(): string | null {
  return useFunil((state) => (state.view === null ? state.error : null))
}

interface ContactLinkProps extends ContatoAlvo {
  /** Nome do contato novo (o do participante, do remetente ou da conversa). */
  nome: string
  origem: ContatoOrigem
}

/**
 * "+ Contato" nas telas existentes (contrato 116, R35 a R37): com um contato ligado ao e-mail, ao telefone ou à conversa,
 * o nome dele como link para a ficha; sem, o `ActionButton` "+ Contato" que cria o contato na hora e vira o link sem sair
 * da tela. O erro do funil fica na dica do botão e numa linha curta abaixo.
 */
export function ContactLink({ email, telefone, whatsappChatId, nome, origem }: ContactLinkProps) {
  const view = useFunilCompartilhado()
  const indisponivel = useFunilIndisponivel()
  const navigate = useNavigate()
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Antes da primeira carga não se sabe se o contato existe: nada, para o botão não piscar. Se a carga falhou, o aviso.
  if (!view) {
    if (!indisponivel) return null
    return (
      <span data-funil-indisponivel="" title={indisponivel} className="shrink-0 text-11 text-text-muted">
        Funil indisponível
      </span>
    )
  }
  const contato = contatoLigado(view.state.contatos, { email, telefone, whatsappChatId })
  if (contato) {
    return (
      <button type="button" data-funil-contato-link={contato.id} className={`${FUNIL_LINK_CLASS} min-w-0 truncate text-13`} onClick={() => void navigate(funilPath('contatos', contato.id))}>
        {contato.nome}
      </button>
    )
  }

  const criar = async (): Promise<void> => {
    setSalvando(true)
    setErro(null)
    const result = await useFunil.getState().saveContato(
      { nome: nome.trim() || email?.trim() || telefone?.trim() || '', emails: email ? [email] : [], telefones: telefone ? [telefone] : [], whatsappChatId: whatsappChatId ?? null },
      origem,
    )
    setSalvando(false)
    if (!result.ok) setErro(result.mensagem)
  }

  return (
    <span data-funil-mais-contato="" title={erro ?? undefined} className="inline-flex shrink-0 flex-col items-end gap-0.5">
      <ActionButton icon={Plus} label="Contato" action="funil-mais-contato" disabled={salvando} onClick={() => void criar()} />
      {erro && (
        <span role="alert" data-funil-mais-contato-erro="" className="max-w-[240px] text-right text-11 text-pretty text-rec">
          {erro}
        </span>
      )}
    </span>
  )
}
