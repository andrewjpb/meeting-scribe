import { describe, expect, it } from 'vitest'
import { emailRuleSchema, newEmailRule, type EmailRule } from '../../src/shared/email-rules'
import {
  availableActions,
  draftToRule,
  moveRule,
  newRuleDraft,
  positionText,
  rulesSaveErrorText,
  rulesSaveOutcome,
  previewText,
  ruleErrorText,
  ruleSummary,
  ruleToDraft,
  runResultText,
  validateRuleDraft,
  whenText,
  type RuleDraft,
} from '../../src/renderer/src/features/settings/rulesFormat'

const name = (path: string): string => path.split('/').join(' › ')
const id = '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'
const rule = (patch: Partial<EmailRule> = {}): EmailRule => ({ ...newEmailRule(id, 'Regra'), conditions: [{ field: 'from', value: '@abf.com.br' }], actions: { moveTo: 'Clientes/ABF', markRead: false, flag: false, delete: false, silent: false, addToCalendar: false }, ...patch })
const at = (day: number, hour: number, minute: number, year = 2026): number => new Date(year, 10, day, hour, minute).getTime()
const now = at(19, 15, 0)

describe('resumo da regra (contrato 55, CA17)', () => {
  it('uma condição', () => {
    expect(ruleSummary(rule({ stopHere: true }), name)).toBe('Se o remetente contém “@abf.com.br” Mover para Clientes › ABF · parar aqui')
  })

  it('várias: "Se todas:" ou "Se qualquer uma:", separadas por vírgula', () => {
    const conditions: EmailRule['conditions'] = [
      { field: 'subject', value: 'fatura' },
      { field: 'subject', value: 'boleto' },
    ]
    const actions = { moveTo: 'Pendentes', markRead: false, flag: true, delete: false, silent: false, addToCalendar: false }
    expect(ruleSummary(rule({ match: 'any', conditions, actions }), name)).toBe('Se qualquer uma: assunto contém “fatura”, assunto contém “boleto” Marcar com estrela · mover para Pendentes')
    expect(ruleSummary(rule({ match: 'all', conditions: [{ field: 'to', value: 'eventos' }, { field: 'hasAttachment' }, { field: 'body', value: 'nota' }], actions }), name)).toBe(
      'Se todas: destinatário ou Cc contém “eventos”, tem anexo, corpo contém “nota” Marcar com estrela · mover para Pendentes',
    )
  })

  it('cada ação, em minúscula depois da primeira', () => {
    expect(ruleSummary(rule({ actions: { moveTo: null, markRead: true, flag: false, delete: false, silent: true, addToCalendar: false } }), name)).toBe('Se o remetente contém “@abf.com.br” Marcar como lida · não avisar')
    expect(ruleSummary(rule({ conditions: [{ field: 'hasAttachment' }], actions: { moveTo: null, markRead: false, flag: false, delete: true, silent: false, addToCalendar: false } }), name)).toBe('Se tem anexo Apagar (vai para a Lixeira)')
  })
})

describe('último erro (contrato 55, CA17)', () => {
  it('cada código, com hoje, ontem e data', () => {
    const gbs = rule({ actions: { moveTo: 'Clientes/GBS', markRead: false, flag: false, delete: false, silent: false, addToCalendar: false } })
    expect(ruleErrorText({ at: at(19, 9, 12), code: 'folder-missing' }, gbs, name, now)).toBe('Último erro hoje, 09:12: a pasta “Clientes › GBS” não existe mais no servidor. O email ficou na Caixa de Entrada.')
    expect(ruleErrorText({ at: at(18, 18, 40), code: 'no-trash' }, gbs, name, now)).toBe('Último erro ontem, 18:40: a conta não tem Lixeira, então a regra não apaga. O email ficou na Caixa de Entrada.')
    expect(ruleErrorText({ at: at(16, 8, 5), code: 'unavailable' }, gbs, name, now)).toBe('Último erro 16/11, 08:05: sem conexão com o servidor. O email ficou na Caixa de Entrada.')
    expect(ruleErrorText({ at: at(16, 8, 5), code: 'server' }, gbs, name, now)).toContain('o servidor recusou. O email ficou na Caixa de Entrada.')
    expect(ruleErrorText({ at: at(16, 8, 5), code: 'pop3' }, gbs, name, now)).toContain('conta POP3 não move, não marca com estrela nem apaga.')
    expect(whenText(at(16, 8, 5, 2025), now)).toBe('16/11/2025, 08:05')
  })
})

describe('"Executar agora" (contrato 55, CA19)', () => {
  it('a frase de cada ação, singular e plural, zero e "não avisar"', () => {
    const read = rule({ actions: { moveTo: null, markRead: true, flag: false, delete: false, silent: true, addToCalendar: false } })
    expect(previewText(read, 23, 200, name)).toBe('23 das 200 mensagens da Caixa de Entrada atendem à regra e serão marcadas como lidas. “Não avisar” não muda nada em email que já chegou.')
    expect(previewText(rule(), 1, 200, name)).toBe('1 das 200 mensagens da Caixa de Entrada atende à regra e será movida para Clientes › ABF.')
    expect(previewText(rule({ actions: { moveTo: null, markRead: false, flag: true, delete: true, silent: false, addToCalendar: false } }), 2, 50, name)).toBe('2 das 50 mensagens da Caixa de Entrada atendem à regra e serão marcadas com estrela e levadas à Lixeira.')
    expect(previewText(rule({ actions: { moveTo: 'A', markRead: true, flag: true, delete: false, silent: false, addToCalendar: false } }), 3, 9, name)).toBe('3 das 9 mensagens da Caixa de Entrada atendem à regra e serão movidas para A, marcadas como lidas e marcadas com estrela.')
    expect(previewText(rule(), 0, 200, name)).toBe('Nenhuma das 200 mensagens da Caixa de Entrada atende à regra.')
  })

  it('resultado', () => {
    expect(runResultText(23, 0)).toBe('Feito em 23 mensagens.')
    expect(runResultText(1, 2)).toBe('Feito em 1 mensagem. 2 já tinham saído da Caixa de Entrada.')
  })
})

describe('editor (contrato 55, CA18)', () => {
  const valid = (): RuleDraft => ({ ...newRuleDraft(id), name: 'ABF', conditions: [{ field: 'from', value: '@abf.com.br' }], actions: [{ kind: 'move', moveTo: 'Clientes/ABF' }] })

  it('regra nova: uma condição "Remetente contém" vazia e nenhuma ação', () => {
    expect(newRuleDraft(id)).toMatchObject({ conditions: [{ field: 'from', value: '' }], actions: [], enabled: true, stopHere: false })
  })

  it('ida e volta da regra para o rascunho, e o que passa aqui passa no esquema do 53', () => {
    const saved = rule({ name: 'Faturas', match: 'any', conditions: [{ field: 'subject', value: 'fatura' }, { field: 'hasAttachment' }], actions: { moveTo: 'Pendentes', markRead: false, flag: true, delete: false, silent: true, addToCalendar: false }, stopHere: true })
    expect(draftToRule(ruleToDraft(saved))).toEqual(saved)
    expect(validateRuleDraft(valid())).toBeNull()
    expect(emailRuleSchema.safeParse(draftToRule(valid())).success).toBe(true)
  })

  it('cada recusa do 53 (CA1), em frase', () => {
    expect(validateRuleDraft({ ...valid(), name: ' ' })).toBe('Dê um nome à regra.')
    expect(validateRuleDraft({ ...valid(), name: 'x'.repeat(101) })).toBe('O nome passa de 100 caracteres.')
    expect(validateRuleDraft({ ...valid(), name: 'a\nb' })).toBe('O nome fica numa linha só.')
    expect(validateRuleDraft({ ...valid(), conditions: [] })).toBe('Adicione ao menos uma condição.')
    expect(validateRuleDraft({ ...valid(), conditions: Array.from({ length: 11 }, () => ({ field: 'from' as const, value: 'a' })) })).toBe('No máximo 10 condições.')
    expect(validateRuleDraft({ ...valid(), conditions: [{ field: 'subject', value: '' }] })).toBe('Escreva o texto de cada condição.')
    expect(validateRuleDraft({ ...valid(), conditions: [{ field: 'subject', value: 'x'.repeat(201) }] })).toBe('O texto de uma condição passa de 200 caracteres.')
    expect(validateRuleDraft({ ...valid(), conditions: [{ field: 'subject', value: 'a\rb' }] })).toBe('O texto de cada condição fica numa linha só.')
    expect(validateRuleDraft({ ...valid(), conditions: [{ field: 'hasAttachment', value: '' }] })).toBeNull()
    expect(validateRuleDraft({ ...valid(), actions: [] })).toBe('Escolha ao menos uma ação.')
    expect(validateRuleDraft({ ...valid(), actions: [{ kind: 'move', moveTo: 'A' }, { kind: 'delete', moveTo: null }] })).toBe('Mover e apagar não vão juntos na mesma regra.')
    expect(validateRuleDraft({ ...valid(), actions: [{ kind: 'move', moveTo: null }] })).toBe('Escolha a pasta de destino.')
    expect(validateRuleDraft({ ...valid(), actions: [{ kind: 'move', moveTo: 'INBOX' }] })).toBe('A regra não move para a Caixa de Entrada.')
    expect(validateRuleDraft({ ...valid(), actions: [{ kind: 'read', moveTo: null }, { kind: 'read', moveTo: null }] })).toBe('Cada ação entra uma vez só.')
    expect(validateRuleDraft(valid(), { pop3: true, hasTrash: false })).toBe('Conta POP3: só marcar como lida, não avisar e pôr na agenda.')
    expect(validateRuleDraft({ ...valid(), actions: [{ kind: 'delete', moveTo: null }] }, { pop3: false, hasTrash: false })).toBe('Esta conta não tem Lixeira.')
  })

  it('ações disponíveis: cada uma uma vez; mover e apagar se excluem; POP3 só as dele; sem Lixeira, sem apagar', () => {
    expect(availableActions({ actions: [] }, { pop3: false, hasTrash: true })).toEqual(['move', 'read', 'flag', 'delete', 'silent', 'calendar'])
    expect(availableActions({ actions: [{ kind: 'move', moveTo: 'A' }] }, { pop3: false, hasTrash: true })).toEqual(['read', 'flag', 'silent', 'calendar'])
    expect(availableActions({ actions: [{ kind: 'move', moveTo: 'A' }] }, { pop3: false, hasTrash: true }, 'move')).toEqual(['move', 'read', 'flag', 'delete', 'silent', 'calendar'])
    expect(availableActions({ actions: [] }, { pop3: true, hasTrash: false })).toEqual(['read', 'silent', 'calendar'])
    expect(availableActions({ actions: [] }, { pop3: false, hasTrash: false })).toEqual(['move', 'read', 'flag', 'silent', 'calendar'])
  })

  it('Subir/Descer e a posição anunciada', () => {
    expect(moveRule(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b'])
    expect(moveRule(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(positionText('Faturas', 2, 4)).toBe('Regra Faturas na posição 2 de 4')
  })
})

describe('gravar as regras (contrato 55, devolução B2)', () => {
  it('`unavailable` é o settings.json que não foi gravado: falha, e a tela volta a lista', () => {
    expect(rulesSaveOutcome({ ok: false, error: 'unavailable' })).toEqual({ ok: false, error: 'unavailable' })
    expect(rulesSaveErrorText('unavailable')).toBe('Não foi possível gravar as regras agora. Nada mudou; tente de novo.')
    expect(rulesSaveOutcome({ ok: false, error: 'folder-missing' })).toEqual({ ok: false, error: 'folder-missing' })
  })

  it('sem conexão com o servidor o main já grava e devolve `ok`: a lista do main vale', () => {
    const saved = [rule()]
    expect(rulesSaveOutcome({ ok: true, rules: saved })).toEqual({ ok: true, rules: saved })
  })
})

describe('"É convite" e "Pôr na agenda" (contrato 64, CA8)', () => {
  const invite = (patch: Partial<EmailRule> = {}): EmailRule => rule({ name: 'Convites', conditions: [{ field: 'isInvite' }], actions: { moveTo: null, markRead: false, flag: false, delete: false, silent: false, addToCalendar: true }, ...patch })
  const draft = (): RuleDraft => ({ ...newRuleDraft(id), name: 'Convites', conditions: [{ field: 'isInvite', value: '' }], actions: [{ kind: 'calendar', moveTo: null }] })

  it('resumo: "é convite" e "pôr na agenda" com a agenda padrão (ou sem ela)', () => {
    expect(ruleSummary(invite(), name, 'Trabalho')).toBe('Se é convite Pôr na agenda “Trabalho”')
    expect(ruleSummary(invite(), name, null)).toBe('Se é convite Pôr na agenda (escolha a agenda padrão)')
    expect(ruleSummary(invite({ actions: { moveTo: 'Convites', markRead: true, flag: false, delete: false, silent: false, addToCalendar: true } }), name, 'Trabalho')).toBe('Se é convite Marcar como lida · mover para Convites · pôr na agenda “Trabalho”')
  })

  it('último erro: sem acesso ao Calendário e sem onde gravar (hoje, ontem e data)', () => {
    expect(ruleErrorText({ at: at(19, 9, 12), code: 'calendar-denied' }, invite(), name, now)).toBe(
      'Último erro hoje, 09:12: sem acesso ao Calendário do Mac, então o convite não foi para a agenda. Dê o acesso em Configurações › Email › Convites.',
    )
    expect(ruleErrorText({ at: at(18, 18, 40), code: 'no-calendar' }, invite(), name, now)).toBe(
      'Último erro ontem, 18:40: o convite não foi para a agenda: escolha a agenda padrão em Configurações › Email › Convites (ou o Calendário do Mac não respondeu).',
    )
    expect(ruleErrorText({ at: at(16, 8, 5), code: 'calendar-denied' }, invite(), name, now)).toBe(
      'Último erro 16/11, 08:05: sem acesso ao Calendário do Mac, então o convite não foi para a agenda. Dê o acesso em Configurações › Email › Convites.',
    )
  })

  it('a frase do "Executar agora"', () => {
    expect(previewText(invite(), 2, 3, name, 'Trabalho')).toBe('2 das 3 mensagens da Caixa de Entrada atendem à regra, com o convite posto na agenda “Trabalho”.')
    expect(previewText(invite({ actions: { moveTo: 'Convites', markRead: false, flag: false, delete: false, silent: false, addToCalendar: true } }), 1, 3, name, 'Trabalho')).toBe(
      '1 das 3 mensagens da Caixa de Entrada atende à regra e será movida para Convites, com o convite posto na agenda “Trabalho”.',
    )
  })

  it('editor: [é convite] → [pôr na agenda] vale e passa no esquema; ida e volta; bloqueios da conta', () => {
    expect(validateRuleDraft(draft())).toBeNull()
    expect(emailRuleSchema.safeParse(draftToRule(draft())).success).toBe(true)
    expect(draftToRule(draft())).toMatchObject({ conditions: [{ field: 'isInvite' }], actions: { addToCalendar: true, moveTo: null, markRead: false } })
    expect(draftToRule(ruleToDraft(invite()))).toEqual(invite())
    expect(validateRuleDraft(draft(), { pop3: true, hasTrash: false })).toBeNull()
    expect(validateRuleDraft(draft(), { pop3: false, hasTrash: true, calendar: 'auto' })).toBe('Sua conta já põe os convites na agenda dela.')
    expect(validateRuleDraft(draft(), { pop3: false, hasTrash: true, calendar: 'no-mac' })).toBe('Pôr na agenda só funciona no Mac.')
    expect(availableActions({ actions: [] }, { pop3: false, hasTrash: true, calendar: 'auto' })).not.toContain('calendar')
    expect(availableActions({ actions: [] }, { pop3: false, hasTrash: true, calendar: 'no-mac' })).not.toContain('calendar')
  })

  it('recusas do rules-set', () => {
    expect(rulesSaveErrorText('auto-calendar')).toBe('Esta conta já põe os convites na agenda dela: tire “Pôr na agenda”.')
    expect(rulesSaveErrorText('no-mac')).toBe('Pôr na agenda só funciona no Mac.')
  })
})
