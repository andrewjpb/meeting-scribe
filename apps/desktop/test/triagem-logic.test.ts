// Contrato 159 (notificacoes-triagem, CA1 a CA5): as regras puras da etiqueta da triagem do WhatsApp. A escolha do dono
// prevalece (âmbito fixo até ele mudar; urgente fixo até chegar mensagem nova), a resposta do dono acaba a urgência, as
// abas e as contagens, as etiquetas da linha e a poda das mais antigas.
import { describe, expect, it } from 'vitest'
import {
  aplicarAgente,
  aplicarManual,
  chipsDe,
  contagensAbas,
  cortarMotivo,
  etiquetaVazia,
  mensagemRecebida,
  naAba,
  podarEtiquetas,
  precisaTriar,
  respostaDoDono,
  TRIAGEM_ABAS,
  TRIAGEM_MOTIVO_MAX,
  type Etiqueta,
  type TriagemAba,
} from '../src/shared/triagem'
import { etiquetaSchema } from '../src/shared/triagem-schema'

describe('etiqueta da triagem (contrato 159)', () => {
  it('CA1: o âmbito escolhido à mão fica fixo; "nenhum" à mão limpa o âmbito e solta', () => {
    const x = aplicarManual(null, { ambito: 'pessoal' }, 10)
    expect(x).toEqual({ urgente: false, ambito: 'pessoal', ambitoFixo: true, urgenteFixo: false, origem: 'manual', lastMessageId: null, motivo: null, at: 10 })
    expect(aplicarManual(x, { ambito: null }, 11)).toMatchObject({ ambito: null, ambitoFixo: false, at: 11 })
    expect(etiquetaVazia(5)).toEqual({ urgente: false, ambito: null, ambitoFixo: false, urgenteFixo: false, origem: 'manual', lastMessageId: null, motivo: null, at: 5 })
  })

  it('CA2: o agente não muda o âmbito fixo, mas marca a urgência e guarda a mensagem e o motivo', () => {
    const e = aplicarManual(null, { ambito: 'pessoal' }, 1)
    expect(aplicarAgente(e, { urgente: true, ambito: 'profissional', motivo: 'm' }, 'msg-9', 2)).toEqual({
      urgente: true,
      ambito: 'pessoal',
      ambitoFixo: true,
      urgenteFixo: false,
      origem: 'agente',
      lastMessageId: 'msg-9',
      motivo: 'm',
      at: 2,
    })
  })

  it('CA3: urgente à mão vale até chegar mensagem nova', () => {
    const e = aplicarManual(null, { urgente: false }, 1)
    expect(e.urgenteFixo).toBe(true)
    expect(aplicarAgente(e, { urgente: true, ambito: 'indefinido', motivo: '' }, 'm1', 2).urgente).toBe(false)
    expect(aplicarAgente(mensagemRecebida(e), { urgente: true, ambito: 'indefinido', motivo: '' }, 'm2', 3).urgente).toBe(true)
    expect(mensagemRecebida(null)).toBeNull()
    // Cópia nova: a original não muda.
    expect(e.urgenteFixo).toBe(true)
  })

  it('CA4: a resposta do dono acaba a urgência e mantém o âmbito; precisaTriar compara a última mensagem', () => {
    const e: Etiqueta = { ...aplicarManual(aplicarManual(null, { ambito: 'profissional' }, 1), { urgente: true }, 2) }
    expect(respostaDoDono(e, 5)).toEqual({ ...e, urgente: false, urgenteFixo: false, at: 5 })
    expect(respostaDoDono(e, 5)).toMatchObject({ ambito: 'profissional', ambitoFixo: true })
    expect(respostaDoDono(null, 5)).toBeNull()
    expect(precisaTriar(null, 'a')).toBe(true)
    expect(precisaTriar({ ...etiquetaVazia(1), lastMessageId: 'a' }, 'a')).toBe(false)
    expect(precisaTriar({ ...etiquetaVazia(1), lastMessageId: 'a' }, 'b')).toBe(true)
  })

  it('CA5: abas, contagens, etiquetas da linha, âmbito indefinido e o motivo cortado', () => {
    const urgenteProfissional = aplicarAgente(null, { urgente: true, ambito: 'profissional', motivo: 'prazo hoje' }, 'm1', 1)
    const pessoal = aplicarAgente(null, { urgente: false, ambito: 'pessoal', motivo: 'família' }, 'm2', 2)
    const chats = [
      { id: 'a@s.whatsapp.net', unread: 2 },
      { id: 'b@s.whatsapp.net', unread: 0 },
      { id: 'c@s.whatsapp.net', unread: 1 },
      { id: 'd@s.whatsapp.net', unread: 0 },
    ]
    const etiquetas: Record<string, Etiqueta> = { 'a@s.whatsapp.net': urgenteProfissional, 'b@s.whatsapp.net': pessoal }
    expect(contagensAbas(chats, etiquetas)).toEqual({ naoLidas: 2, urgentes: 1 })
    const lista = (aba: TriagemAba): string[] => chats.filter((chat) => naAba(chat, etiquetas[chat.id] ?? null, aba)).map((chat) => chat.id)
    expect(TRIAGEM_ABAS).toEqual(['todas', 'nao-lidas', 'urgentes', 'pessoal', 'profissional'])
    expect(lista('todas')).toHaveLength(4)
    expect(lista('nao-lidas')).toEqual(['a@s.whatsapp.net', 'c@s.whatsapp.net'])
    expect(lista('urgentes')).toEqual(['a@s.whatsapp.net'])
    expect(lista('profissional')).toEqual(['a@s.whatsapp.net'])
    expect(lista('pessoal')).toEqual(['b@s.whatsapp.net'])
    expect(chipsDe(urgenteProfissional)).toEqual(['Urgente', 'Profissional'])
    expect(chipsDe(pessoal)).toEqual(['Pessoal'])
    expect(chipsDe(null)).toEqual([])
    expect(aplicarAgente(null, { urgente: false, ambito: 'indefinido', motivo: 'x' }, 'm3', 3).ambito).toBeNull()
    // Contrato 171 (C6): o motivo longo sai cortado com "…", dentro do limite.
    const etiqueta = aplicarAgente(null, { urgente: false, ambito: 'pessoal', motivo: 'y'.repeat(300) }, 'm4', 4)
    expect(etiqueta.motivo?.length).toBeLessThanOrEqual(TRIAGEM_MOTIVO_MAX)
    expect(etiqueta.motivo?.endsWith('…')).toBe(true)
    expect(etiquetaSchema.safeParse(etiqueta).success).toBe(true)
    expect(TRIAGEM_MOTIVO_MAX).toBe(160)
  })

  it('contrato 171 (C6): o motivo longo é cortado na última palavra inteira, com "…"; o curto não muda', () => {
    const curto = 'Pedido de orçamento com prazo.'
    expect(cortarMotivo(curto)).toBe(curto)
    expect(cortarMotivo('a'.repeat(160))).toBe('a'.repeat(160))
    const longo = Array.from({ length: 40 }, (_, i) => `palavra${i}`).join(' ')
    const cortado = cortarMotivo(longo)
    expect(cortado.length).toBeLessThanOrEqual(TRIAGEM_MOTIVO_MAX)
    expect(cortado.endsWith('…')).toBe(true)
    // Só palavras inteiras antes do "…".
    const palavras = cortado.slice(0, -1).split(' ')
    expect(palavras.every((palavra, i) => palavra === `palavra${i}`)).toBe(true)
    expect(longo.startsWith(cortado.slice(0, -1))).toBe(true)
    // Uma palavra só, maior que o limite: corta no meio dela.
    expect(cortarMotivo('z'.repeat(300))).toBe(`${'z'.repeat(159)}…`)
    expect(cortarMotivo('um dois três quatro', 10)).toBe('um dois…')
  })

  it('a poda fica com as mais recentes por `at`', () => {
    const etiquetas: Record<string, Etiqueta> = { velha: etiquetaVazia(1), media: etiquetaVazia(2), nova: etiquetaVazia(3) }
    expect(Object.keys(podarEtiquetas(etiquetas, 2)).sort()).toEqual(['media', 'nova'])
    expect(podarEtiquetas(etiquetas, 5)).toEqual(etiquetas)
  })
})
