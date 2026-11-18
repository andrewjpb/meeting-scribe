// Painel Detalhes do WhatsApp (contrato 32): os gráficos locais como funções puras (atividade, quem fala, humor no
// tempo), o avatar (iniciais e cor pelo id) e os textos da conversa (sequência do mesmo autor, telefone).
import { describe, expect, it } from 'vitest'
import { AVATAR_TONES, AVATAR_TONE_CLASSES, avatarInitials, avatarTone } from '../../src/renderer/src/features/whatsapp/avatar-tone'
import {
  ACTIVITY_DAYS,
  activityBars,
  activityDays,
  activitySummary,
  BAR_MAX,
  balanceSegments,
  balanceSummary,
  GAP,
  moodLevels,
  moodPoints,
  moodSummary,
  talkBalance,
} from '../../src/renderer/src/features/whatsapp/chart-data'
import { chatPhone, startsRun } from '../../src/renderer/src/features/whatsapp/format'
import type { WhatsAppMessage } from '../../src/shared/whatsapp'

const NOW = new Date(2026, 10, 18, 15, 30).getTime()
const at = (daysAgo: number, hour = 10): number => new Date(2026, 10, 18 - daysAgo, hour).getTime()
const msg = (id: string, when: number, fromMe: boolean, author = fromMe ? 'Você' : 'Ana'): WhatsAppMessage => ({ id, chatId: 'c@s.whatsapp.net', author, fromMe, at: when, type: 'text', text: id, media: null })

describe('Atividade: mensagens por dia nos últimos 14 dias', () => {
  const messages = [msg('a', at(0), true), msg('b', at(0, 11), false), msg('c', at(0, 23), false), msg('d', at(3), false), msg('e', at(13), true), msg('velha', at(14), false), msg('futura', at(-1), false)]

  it('14 dias até hoje, do mais antigo ao mais novo, contando só os do período', () => {
    const days = activityDays(messages, NOW)
    expect(days).toHaveLength(ACTIVITY_DAYS)
    expect(days[0]).toEqual({ day: '2026-11-05', count: 1 })
    expect(days.at(-1)).toEqual({ day: '2026-11-18', count: 3 })
    expect(days.find((day) => day.day === '2026-11-15')?.count).toBe(1)
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(5)
  })

  it('barras finas da mesma base, com intervalo, proporcionais ao pico; o pico é o dia mais recente com o máximo', () => {
    const { bars, max, peak } = activityBars(activityDays(messages, NOW), 280, 60)
    expect(max).toBe(3)
    expect(bars.every((bar) => bar.width <= BAR_MAX && bar.width <= 280 / 14 - GAP)).toBe(true)
    expect(bars.every((bar) => Math.abs(bar.y + bar.height - 60) < 0.01)).toBe(true)
    expect(bars.at(-1)?.height).toBe(60)
    expect(bars[0]?.height).toBe(20)
    expect(bars.find((bar) => bar.count === 0)?.height).toBe(0)
    expect(peak?.day).toBe('2026-11-18')
    // Sem mensagem nenhuma, nenhuma barra cresce.
    expect(activityBars(activityDays([], NOW), 280, 60)).toMatchObject({ max: 0, peak: null })
  })

  it('o resumo em texto diz o total, os dias com mensagem e o pico', () => {
    expect(activitySummary(activityDays(messages, NOW))).toBe('5 mensagens em 3 dias dos últimos 14; o dia com mais foi 18/11, com 3.')
    expect(activitySummary(activityDays([], NOW))).toBe('Nenhuma mensagem carregada nos últimos 14 dias.')
  })
})

describe('Quem fala: você × eles', () => {
  it('percentuais inteiros que somam 100 e os dois segmentos com o intervalo', () => {
    const balance = talkBalance([msg('a', 1, true), msg('b', 2, false), msg('c', 3, false)])
    expect(balance).toEqual({ mine: 1, theirs: 2, total: 3, minePct: 33, theirsPct: 67 })
    const segments = balanceSegments(balance, 302)
    expect(segments).toEqual([
      { who: 'mine', x: 0, width: 100 },
      { who: 'theirs', x: 102, width: 200 },
    ])
    expect(balanceSummary(balance, false)).toBe('Você mandou 1 mensagem (33%) e o outro lado, 2 (67%).')
    expect(balanceSummary(balance, true)).toContain('e o grupo, 2')
  })

  it('só um lado ocupa a barra toda; nenhum lado some com poucas mensagens; vazio não desenha nada', () => {
    expect(balanceSegments(talkBalance([msg('a', 1, true)]), 100)).toEqual([{ who: 'mine', x: 0, width: 100 }])
    expect(balanceSegments(talkBalance([msg('a', 1, false)]), 100)).toEqual([{ who: 'theirs', x: 0, width: 100 }])
    const few = balanceSegments(talkBalance([msg('a', 1, true), ...Array.from({ length: 300 }, (_, i) => msg(`b${i}`, i, false))]), 100)
    expect(few[0]?.width).toBe(2)
    expect(balanceSegments(talkBalance([]), 100)).toEqual([])
    expect(talkBalance([])).toEqual({ mine: 0, theirs: 0, total: 0, minePct: 0, theirsPct: 0 })
  })
})

describe('Humor no tempo (humorDias da IA)', () => {
  it('pontos pela data, satisfeito em cima e insatisfeito embaixo; um dia só fica no meio', () => {
    const points = moodPoints(
      [
        { dia: '2026-11-16', valor: 'negativo' },
        { dia: '2026-11-10', valor: 'positivo' },
        { dia: '2026-11-12', valor: 'neutro' },
      ],
      112,
      64,
    )
    expect(points.map((point) => point.dia)).toEqual(['2026-11-10', '2026-11-12', '2026-11-16'])
    expect(points.map((point) => point.x)).toEqual([6, 39.33, 106])
    expect(points.map((point) => point.y)).toEqual([6, 32, 58])
    expect(moodPoints([{ dia: '2026-11-10', valor: 'neutro' }], 100, 64)).toEqual([{ dia: '2026-11-10', valor: 'neutro', x: 50, y: 32 }])
    expect(moodPoints([], 100, 64)).toEqual([])
    expect(moodLevels(64).map((level) => `${level.label}@${level.y}`)).toEqual(['Satisfeito@6', 'Neutro@32', 'Insatisfeito@58'])
    expect(moodSummary([{ dia: '2026-11-10', valor: 'positivo' }])).toBe('10/11: satisfeito')
  })
})

describe('Avatar', () => {
  it('iniciais: primeira e última palavra, uma letra se for uma palavra, número sem letra vira o primeiro caractere', () => {
    expect(avatarInitials('Ana Souza')).toBe('AS')
    expect(avatarInitials('  bruno  de lima ')).toBe('BL')
    expect(avatarInitials('Projeto')).toBe('P')
    expect(avatarInitials('Élio Ávila')).toBe('ÉÁ')
    expect(avatarInitials('Time 🚀 Atlas')).toBe('TA')
    expect(avatarInitials('5511922220000')).toBe('5')
    expect(avatarInitials('')).toBe('?')
  })

  it('cor determinística pelo id, sempre uma das cores dos post-its, com fundo e texto dos tokens', () => {
    const ids = Array.from({ length: 60 }, (_, index) => `55119${index}@s.whatsapp.net`)
    expect(ids.map(avatarTone)).toEqual(ids.map(avatarTone))
    expect(avatarTone('5511911110000@s.whatsapp.net')).toBe(avatarTone('5511911110000@s.whatsapp.net'))
    expect(new Set(ids.map(avatarTone)).size).toBeGreaterThan(3)
    for (const tone of AVATAR_TONES) expect(AVATAR_TONE_CLASSES[tone]).toBe(`bg-note-${tone} text-note-${tone}-text`)
  })
})

describe('conversa', () => {
  it('uma sequência do mesmo autor começa na primeira mensagem e a cada troca de autor', () => {
    const list = [msg('a', 1, false), msg('b', 2, false), msg('c', 3, true), msg('d', 4, false, 'Bruno')]
    expect(list.map((item, index) => startsRun(item, list[index - 1]))).toEqual([true, false, true, true])
  })

  it('telefone: o do @lid, o do id de pessoa; grupo sem telefone', () => {
    expect(chatPhone({ id: '5511911110000@s.whatsapp.net', kind: 'person' })).toBe('+5511911110000')
    expect(chatPhone({ id: '123@lid', kind: 'person', phone: '+5511944440000' })).toBe('+5511944440000')
    expect(chatPhone({ id: '123@lid', kind: 'person' })).toBeNull()
    expect(chatPhone({ id: '120363000000000001@g.us', kind: 'group' })).toBeNull()
  })
})
