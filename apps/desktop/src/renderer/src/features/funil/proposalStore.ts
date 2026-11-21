// Proposta de IA da reunião na aba Resumo (contrato 116, R39 e R40): carrega pelo `scribe:funil-proposta-get`, recarrega
// a cada `scribe:funil-proposta-changed` da reunião e expõe o "Detectar oportunidade" e as ações do cartão. Os textos e as
// escolhas do cartão que não dependem da tela também ficam aqui (testados em test/renderer/funil-format.test.ts).
import { useCallback, useEffect, useRef, useState } from 'react'
import { FUNIL_TRANSPORTE_TEXTO, type Etapa } from '@shared/funil'
import { semAcento } from '@shared/funil-logic'
import type { FunilPropostaAplicarResult, FunilPropostaCampos, FunilPropostaView } from '@shared/funil-proposta'
import { rereadWhenUnlocked } from '../../app/lockStore'

/** Depois do evento, o main pode ainda marcar a detecção como em curso por um instante: lê de novo, até este tanto. */
const RELEITURAS_MAX = 10
const RELEITURA_MS = 200

export interface PropostaDaReuniao {
  /** `null` até a primeira leitura. */
  view: FunilPropostaView | null
  /** A última leitura ou o "Detectar" falhou (texto para a tela). */
  erro: string | null
  detectar: () => Promise<void>
  aplicar: (campos: FunilPropostaCampos, vincularA?: string) => Promise<FunilPropostaAplicarResult>
  /** "Ignorar": `true` quando o arquivo ficou `dismissed`. */
  descartar: () => Promise<boolean>
}

const FALHA = { ok: false, mensagem: FUNIL_TRANSPORTE_TEXTO } as const

export function useProposta(meetingId: string): PropostaDaReuniao {
  const [entry, setEntry] = useState<{ meetingId: string; view: FunilPropostaView | null; erro: string | null } | null>(null)
  const atual = entry?.meetingId === meetingId ? entry : null
  // Cada pedido leva um número: a resposta de um pedido mais antigo que a última aplicada não volta a tela para trás (o
  // "Detectar" responde "detectando" e pode chegar depois da leitura que já viu o resultado). O que chegar de outra
  // reunião (a tela trocou no meio) não vale.
  const pedidos = useRef(0)
  const aplicado = useRef(0)
  const vigente = useRef(meetingId)

  const mostrar = useCallback((de: string, numero: number, result: FunilPropostaView | { ok: false; mensagem: string }): boolean => {
    if (de !== vigente.current || numero < aplicado.current) return false
    aplicado.current = numero
    if ('ok' in result) {
      setEntry((current) => ({ meetingId: de, view: current?.meetingId === de ? current.view : null, erro: result.mensagem }))
      return false
    }
    setEntry({ meetingId: de, view: result, erro: null })
    return true
  }, [])

  useEffect(() => {
    vigente.current = meetingId
    aplicado.current = 0
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    // Recusada com o app bloqueado (contrato 22): relê no desbloqueio.
    let reread: (() => void) | null = null
    const ler = (releituras: number): void => {
      const numero = ++pedidos.current
      window.__scribeApi.invoke('scribe:funil-proposta-get', { meetingId }).then(
        (result) => {
          if (!alive || !mostrar(meetingId, numero, result) || !('detectando' in result) || !result.detectando || releituras <= 0) return
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => ler(releituras - 1), RELEITURA_MS)
        },
        (error: unknown) => {
          if (!alive) return
          reread = rereadWhenUnlocked(error, () => ler(0))
          if (!reread) mostrar(meetingId, numero, FALHA)
        },
      )
    }
    ler(0)
    const off = window.__scribeApi.on('scribe:funil-proposta-changed', (event) => {
      if (alive && event.meetingId === meetingId) ler(RELEITURAS_MAX)
    })
    return () => {
      alive = false
      reread?.()
      off()
      if (timer) clearTimeout(timer)
    }
  }, [meetingId, mostrar])

  const detectar = useCallback(async (): Promise<void> => {
    const numero = ++pedidos.current
    try {
      mostrar(meetingId, numero, await window.__scribeApi.invoke('scribe:funil-proposta-detectar', { meetingId }))
    } catch {
      mostrar(meetingId, numero, FALHA)
    }
  }, [meetingId, mostrar])

  const aplicar = useCallback(
    async (campos: FunilPropostaCampos, vincularA?: string): Promise<FunilPropostaAplicarResult> => {
      try {
        return await window.__scribeApi.invoke('scribe:funil-proposta-aplicar', vincularA === undefined ? { meetingId, campos } : { meetingId, campos, vincularA })
      } catch {
        return { ok: false, erro: 'falhou', mensagem: FUNIL_TRANSPORTE_TEXTO }
      }
    },
    [meetingId],
  )

  const descartar = useCallback(async (): Promise<boolean> => {
    try {
      return (await window.__scribeApi.invoke('scribe:funil-proposta-descartar', { meetingId })).ok
    } catch {
      return false
    }
  }, [meetingId])

  return { view: atual?.view ?? null, erro: atual?.erro ?? null, detectar, aplicar, descartar }
}

const chave = (texto: string): string => semAcento(texto).trim().replace(/\s+/g, ' ').toLowerCase()

/** A etapa pré-escolhida no cartão: a aberta com o nome da `etapaSugerida` (sem acento e sem caixa) ou a primeira aberta. */
export function etapaInicial(etapas: readonly Etapa[], sugerida: string): Etapa | null {
  const abertas = etapas.filter((etapa) => etapa.tipo === 'aberta').sort((a, b) => a.ordem - b.ordem)
  return abertas.find((etapa) => chave(etapa.nome) === chave(sugerida)) ?? abertas[0] ?? null
}

/** "Carlos Dias", "Carlos Dias e Ana Lima", "Carlos Dias, Ana Lima e Bia Reis". */
function lista(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? ''
  return `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1) ?? ''}`
}

/**
 * O resumo do efeito ao lado dos botões do cartão (R39): "Cria os 2 contatos novos e a empresa"; com contato sem e-mail,
 * "… · Carlos Dias fica só citado na nota". Sem nada a criar nem citar, vazio.
 */
export function textoEfeito({ contatosNovos, empresaNova, citados }: { contatosNovos: number; empresaNova: boolean; citados: readonly string[] }): string {
  const cria = [contatosNovos === 1 ? 'o contato novo' : contatosNovos > 1 ? `os ${contatosNovos} contatos novos` : '', empresaNova ? 'a empresa' : ''].filter(Boolean)
  const partes = [cria.length ? `Cria ${cria.join(' e ')}` : '']
  const nomes = citados.filter((nome) => nome.trim())
  if (nomes.length) partes.push(`${lista(nomes)} ${nomes.length === 1 ? 'fica só citado' : 'ficam só citados'} na nota`)
  return partes.filter(Boolean).join(' · ')
}
