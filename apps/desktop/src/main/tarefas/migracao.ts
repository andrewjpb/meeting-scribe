// Tarefas (contrato 121, R35, D11): a migração única do próximo passo das oportunidades e dos lembretes das
// Automações para tarefas. As dependências chegam injetadas (os adaptadores nos stores do funil e das Automações são
// do 124), então aqui fica só a ordem e o desfazer. Ordem: lê tudo → monta → cópias → grava `tarefas.json` (anexando,
// com `migradoEm`) → tira os lembretes de `schedules.json` → tira o próximo passo de `funil.json`. Falha antes da
// gravação não grava nada; depois dela, desfaz as três. O log diz só o passo e contagens.
import { TAREFA_DETALHE_MAX, TAREFA_TITULO_MAX, type TarefaNova, type TarefasArquivo, type VinculosTarefa } from '../../shared/tarefas'
import { diaNoFuso, diaValido } from '../../shared/tarefas-logic'
import type { TarefasStore } from './store'

/** Próximo passo gravado numa oportunidade, como o funil o entrega para a migração. */
export interface PassoLegado {
  oportunidadeId: string
  texto: string
  data: string | null
  /** A oportunidade está numa etapa aberta. */
  aberta: boolean
  contatoIds: string[]
  empresaId: string | null
}

/** `ScheduledTask` com `reminder`, como as Automações o entregam para a migração. */
export interface LembreteLegado {
  id: string
  texto: string
  nextRunAt: number | null
  whatsappChatId: string | null
  email: { accountId: string; messageId: string; label: string; mailbox?: string | null } | null
}

export interface MigracaoDeps {
  tarefas: Pick<TarefasStore, 'read' | 'aplicarMigracao' | 'reverterMigracao'>
  funil: { legado(): Promise<PassoLegado[]>; backup(): Promise<void>; limpar(): Promise<void>; restaurar(): Promise<void> }
  /** `lembretes()` devolve `null` quando `schedules.json` existe mas é inválido (ausente = `[]`). */
  schedules: { lembretes(): Promise<LembreteLegado[] | null>; backup(): Promise<void>; remover(ids: string[]): Promise<void>; restaurar(): Promise<void> }
  timeZone: () => string
  now?: () => number
  /** Aceito pela forma do contrato, mas sem uso: os ids das tarefas saem do store. */
  newId?: () => string
  log?: (message: string) => void
}

export type MigracaoPasso = 'leitura' | 'backup' | 'gravacao' | 'limpeza'

export type MigracaoResult = { ok: true; migradas: number; jaMigrado: boolean } | { ok: false; passo: MigracaoPasso }

const vinculosVazios = (): VinculosTarefa => ({ oportunidadeId: null, contatoIds: [], empresaId: null, meetingId: null, email: null, whatsappChatId: null })

/** Texto longo: os primeiros 200 caracteres no título e o resto no detalhe (até 2000). Vazio vira o `reserva`. */
function tituloEDetalhe(texto: string, reserva: string): { titulo: string; detalhe: string } {
  const limpo = typeof texto === 'string' ? texto.trim() : ''
  if (!limpo) return { titulo: reserva, detalhe: '' }
  return { titulo: limpo.slice(0, TAREFA_TITULO_MAX).trim(), detalhe: limpo.slice(TAREFA_TITULO_MAX).trim().slice(0, TAREFA_DETALHE_MAX) }
}

/** O estado lido equivale ao arquivo ausente (nada gravado nele): desfazer é apagar. */
const vazio = (state: TarefasArquivo): boolean => state.tarefas.length === 0 && state.ignorados.length === 0 && state.migradoEm === null && state.ultimoAvisoHojeEm === null

export async function migrarTarefas(deps: MigracaoDeps): Promise<MigracaoResult> {
  const { tarefas, funil, schedules, timeZone, now = Date.now, log = () => undefined } = deps
  const falhou = (passo: MigracaoPasso): MigracaoResult => {
    log(`[tarefas] migração falhou no passo ${passo}`)
    return { ok: false, passo }
  }

  let anterior: TarefasArquivo
  let passos: PassoLegado[]
  let lembretes: LembreteLegado[] | null
  try {
    const lido = await tarefas.read()
    if (!lido.ok) return falhou('leitura')
    if (lido.value.migradoEm !== null) return { ok: true, migradas: 0, jaMigrado: true }
    anterior = lido.value
    passos = await funil.legado()
    lembretes = await schedules.lembretes()
  } catch {
    return falhou('leitura')
  }

  const at = now()
  const fuso = timeZone()
  const novas: TarefaNova[] = []
  let dePassos = 0
  for (const passo of passos) {
    if (!passo.aberta) continue
    novas.push({
      ...tituloEDetalhe(passo.texto, 'Próximo passo'),
      prazo: diaValido(passo.data) ? passo.data : null,
      // D-8: sem lembrete, senão os passos já vencidos disparariam na primeira abertura.
      lembreteEm: null,
      importante: false,
      responsavel: { tipo: 'eu' },
      origem: { tipo: 'migracao', de: 'proximo-passo' },
      vinculos: { ...vinculosVazios(), oportunidadeId: passo.oportunidadeId, contatoIds: [...new Set(passo.contatoIds)], empresaId: passo.empresaId },
    })
    dePassos++
  }
  let deLembretes = 0
  for (const lembrete of lembretes ?? []) {
    // D-4: só o que ainda vai avisar vira tarefa; os já disparados e os desligados só saem de `schedules.json`.
    if (lembrete.nextRunAt === null || lembrete.nextRunAt <= at) continue
    const email = lembrete.email ? { accountId: lembrete.email.accountId, id: lembrete.email.messageId, assunto: lembrete.email.label, mailbox: lembrete.email.mailbox ?? null } : null
    novas.push({
      ...tituloEDetalhe(lembrete.texto, 'Lembrete'),
      // D-7: o dia local do aviso, para aparecer em Hoje no dia.
      prazo: diaNoFuso(lembrete.nextRunAt, fuso),
      lembreteEm: lembrete.nextRunAt,
      importante: false,
      responsavel: { tipo: 'eu' },
      origem: { tipo: 'migracao', de: 'lembrete' },
      vinculos: { ...vinculosVazios(), whatsappChatId: lembrete.whatsappChatId, email },
    })
    deLembretes++
  }

  const comFunil = passos.length > 0
  const comSchedules = lembretes !== null && lembretes.length > 0
  const ids = comSchedules ? (lembretes ?? []).map((lembrete) => lembrete.id) : []

  try {
    if (comFunil) await funil.backup()
    if (comSchedules) await schedules.backup()
  } catch {
    return falhou('backup')
  }

  try {
    const gravado = await tarefas.aplicarMigracao(novas, at)
    if (!gravado.ok) return falhou('gravacao')
  } catch {
    return falhou('gravacao')
  }

  try {
    if (comSchedules) await schedules.remover(ids)
    if (comFunil) await funil.limpar()
  } catch {
    // Desfaz as três gravações; cada uma é tentada mesmo que outra falhe.
    const reverter = async (): Promise<void> => {
      const result = await tarefas.reverterMigracao(vazio(anterior) ? null : anterior)
      if (!result.ok) throw new Error(result.erro)
    }
    const desfazer: [string, () => Promise<unknown>][] = [['tarefas', reverter]]
    if (comSchedules) desfazer.push(['schedules', () => schedules.restaurar()])
    if (comFunil) desfazer.push(['funil', () => funil.restaurar()])
    for (const [nome, acao] of desfazer) {
      try {
        await acao()
      } catch {
        log(`[tarefas] migração: não foi possível desfazer ${nome}`)
      }
    }
    return falhou('limpeza')
  }

  log(`[tarefas] migração: ${novas.length} tarefas (${dePassos} de próximo passo, ${deLembretes} de lembrete; ${ids.length} lembretes tirados das Automações)`)
  return { ok: true, migradas: novas.length, jaMigrado: false }
}
