// Textos da aba "Atendimento" (contrato 142, CA9 a CA14).
import { describe, expect, it } from 'vitest'
import type { AtendimentoBinding, AtendimentoLogEntry } from '../../src/shared/atendimento'
import { agentUsage, chatLabel, duplicateName, logActionLabel, logDetail, logWhen } from '../../src/renderer/src/features/atendimento/format'

const binding = (agentId: string, mode: AtendimentoBinding['mode'], enabled = true): Pick<AtendimentoBinding, 'agentId' | 'enabled' | 'mode'> => ({ agentId, mode, enabled })

describe('logActionLabel (CA9)', () => {
  it.each([
    ['sent', 'Respondeu'],
    ['drafted', 'Propôs'],
    ['draft-sent', 'Você enviou a proposta'],
    ['draft-discarded', 'Você descartou a proposta'],
    ['handed-off', 'Passou para você'],
    ['paused', 'Pausou'],
    ['cancelled', 'Cancelou a resposta'],
    ['rate-limited', 'Limite atingido'],
    ['out-of-hours', 'Fora do horário'],
    ['failed', 'Não conseguiu responder'],
  ] as const)('%s → %s', (action, label) => {
    expect(logActionLabel(action)).toBe(label)
  })
})

describe('logDetail (CA10)', () => {
  const entry: AtendimentoLogEntry = { at: '2026-11-23T10:00:00.000Z', chatId: '5511@s.whatsapp.net', agentId: 'a', action: 'sent' }
  it('devolve o motivo quando existe', () => {
    expect(logDetail({ ...entry, action: 'handed-off', reason: 'chegou um áudio' })).toBe('chegou um áudio')
  })
  it('sem motivo, vazio', () => {
    expect(logDetail(entry)).toBe('')
  })
  it('nunca devolve o id da mensagem', () => {
    expect(logDetail({ ...entry, messageId: 'ABC123' })).toBe('')
  })
})

describe('logWhen (CA11)', () => {
  const now = new Date(2026, 10, 23, 16, 0)
  it('mesmo dia local', () => {
    expect(logWhen(new Date(2026, 10, 23, 14, 51).toISOString(), now)).toBe('Hoje, 14:51')
  })
  it('dia anterior', () => {
    expect(logWhen(new Date(2026, 10, 22, 23, 10).toISOString(), now)).toBe('Ontem, 23:10')
  })
  it('mais antigo', () => {
    expect(logWhen(new Date(2026, 10, 20, 9, 2).toISOString(), now)).toBe('20/11, 09:02')
  })
})

describe('agentUsage (CA12)', () => {
  it('nenhum atendimento ligado', () => {
    expect(agentUsage('a', [binding('a', 'auto', false), binding('b', 'auto')])).toBe('Nenhuma conversa')
  })
  it('um, responder sozinho', () => {
    expect(agentUsage('a', [binding('a', 'auto'), binding('b', 'draft')])).toBe('1 conversa · Responder sozinho')
  })
  it('dois, rascunho', () => {
    expect(agentUsage('a', [binding('a', 'draft'), binding('a', 'draft'), binding('a', 'auto', false)])).toBe('2 conversas · Rascunho')
  })
  it('modos misturados', () => {
    expect(agentUsage('a', [binding('a', 'draft'), binding('a', 'auto'), binding('a', 'draft')])).toBe('3 conversas · Rascunho e sozinho')
  })
})

describe('duplicateName (CA13)', () => {
  it('primeira cópia', () => {
    expect(duplicateName('Recados', ['Recados'])).toBe('Recados (cópia)')
  })
  it('com a cópia já existindo, numera (sem diferenciar maiúsculas)', () => {
    expect(duplicateName('Recados', ['Recados', 'recados (CÓPIA)'])).toBe('Recados (cópia 2)')
  })
  it('nunca passa de 60 caracteres: corta o nome original', () => {
    const name = 'x'.repeat(60)
    const copy = duplicateName(name, [name])
    expect(copy.length).toBeLessThanOrEqual(60)
    expect(copy.endsWith(' (cópia)')).toBe(true)
    expect(duplicateName(name, [name, copy]).length).toBeLessThanOrEqual(60)
  })
})

describe('chatLabel (CA14)', () => {
  const chats = [{ id: '5511988887777@s.whatsapp.net', name: 'Ana' }]
  it('o nome da conversa na lista', () => {
    expect(chatLabel('5511988887777@s.whatsapp.net', chats)).toBe('Ana')
  })
  it('fora da lista, o número sem o sufixo', () => {
    expect(chatLabel('5511911112222@s.whatsapp.net', chats)).toBe('5511911112222')
  })
})
