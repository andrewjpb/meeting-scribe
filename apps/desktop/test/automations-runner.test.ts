import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AcpOpenResult, AcpSessionRequest } from '../src/main/acp/agent'
import type { ChatEngine } from '../src/main/acp/chat'
import { claudeProfile } from '../src/main/acp/profiles/claude'
import type { ChatAnswer } from '../src/main/claude-cli/chat'
import { createFileNotesStore } from '../src/main/meetings/notes'
import { applyOutput } from '../src/main/schedules/outputs'
import { agentSystemPrompt, createAgentRunner, FUNIL_INSTRUCAO, type AgentRunRequest } from '../src/main/schedules/runner'
import type { Chat } from '../src/shared/chat'
import type { MeetingNote } from '../src/shared/meeting-notes'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'automacoes-execucao-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const corpus = (): Parameters<typeof createAgentRunner>[0]['corpus'] & { dropped: string[] } => {
  const dropped: string[] = []
  return {
    dir: join(dir, 'acervo'),
    dropped,
    ensure: () => Promise.resolve(),
    scope: (meetingId, key) => Promise.resolve(meetingId === 'r1' ? join(dir, 'escopo', key) : null),
    scopeMany: (_ids, key) => Promise.resolve(join(dir, 'escopo', key)),
    dropScope: (key) => {
      dropped.push(key)
      return Promise.resolve()
    },
  }
}

const request = (patch: Partial<AgentRunRequest> = {}): AgentRunRequest => ({
  runId: 'run-1',
  agent: { name: 'Resumo', instructions: 'Liste as decisões.', profile: 'claude', model: 'sonnet', thinkMore: false, scope: { kind: 'all' }, web: false, funil: false },
  prompt: 'Agora: segunda, 16/11/2026 08:00 (America/Sao_Paulo).\n\nResuma.',
  meetingId: null,
  timeoutS: 30,
  ...patch,
})

describe('execução de um agente (contrato 23, CA5 e CA10)', () => {
  it('abre uma sessão ACP de chat só leitura, com as instruções do agente, no acervo, sem MCP nem configurações pessoais', async () => {
    const opened: AcpSessionRequest[] = []
    const runner = createAgentRunner({
      locate: () => Promise.resolve({ ok: true, path: '/bin/claude', version: '2.0.0' }),
      openAcp: () => (req) => {
        opened.push(req)
        return Promise.resolve<AcpOpenResult>({ ok: false, error: 'failed', reason: 'teste' })
      },
      corpus: corpus(),
      meetings: { list: () => Promise.resolve([]) },
      emptyDir: join(dir, 'vazia'),
    })
    const result = await runner.run(request(), () => undefined)
    expect(result.status).toBe('error')
    expect(opened).toHaveLength(1)
    const session = opened[0]
    expect(session).toMatchObject({ purpose: 'chat', tools: 'read', cwd: join(dir, 'acervo'), model: 'sonnet', thinkMore: false })
    expect(session?.systemPrompt).toContain('<instrucoes_do_agente>\nListe as decisões.\n</instrucoes_do_agente>')
    expect(session?.systemPrompt).toContain('nunca envia nada a ninguém')
    // O perfil do Claude monta o `session/new` com o isolamento do contrato 17: sem configurações pessoais, sem
    // MCP, só leitura, sem shell, escrita, rede nem subagente.
    const created = claudeProfile.newSession(session as AcpSessionRequest)
    const options = (created._meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options
    expect(created.mcpServers).toEqual([])
    expect(options['settingSources']).toEqual([])
    expect(options['tools']).toEqual(['Read', 'Grep', 'Glob'])
    expect(options['disallowedTools']).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Task']))
    expect(options['strictMcpConfig']).toBe(true)
  })

  it('contrato 26: o agente com "Pode pesquisar na internet" abre a sessão com a internet; sem, a de sempre', async () => {
    const opened: AcpSessionRequest[] = []
    const runner = createAgentRunner({
      locate: () => Promise.resolve({ ok: true, path: '/bin/claude', version: '2.0.0' }),
      openAcp: () => (req) => {
        opened.push(req)
        return Promise.resolve<AcpOpenResult>({ ok: false, error: 'failed', reason: 'teste' })
      },
      corpus: corpus(),
      meetings: { list: () => Promise.resolve([]) },
      emptyDir: join(dir, 'vazia'),
    })
    await runner.run(request({ agent: { ...request().agent, web: true } }), () => undefined)
    await runner.run(request({ runId: 'run-2' }), () => undefined)
    expect(opened.map((session) => session.web === true)).toEqual([true, false])
    expect(opened[0]?.systemPrompt).toContain('[Web · <domínio> · <título curto>](<endereço>)')
    expect(opened[1]?.systemPrompt).toContain("Para isso, ligue 'Pode pesquisar na internet' neste agente.")
    const options = (claudeProfile.newSession(opened[0] as AcpSessionRequest)._meta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options
    expect(options['tools']).toEqual(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'])
  })

  it('o escopo vira a pasta: só a reunião que acabou, as do escopo numa pasta própria (apagada no fim) ou uma pasta vazia', async () => {
    const cwds: string[] = []
    const store = corpus()
    const runner = createAgentRunner({
      locate: () => Promise.resolve({ ok: true, path: '/bin/claude', version: '2.0.0' }),
      openAcp: () => () => Promise.resolve<AcpOpenResult>({ ok: false, error: 'failed', reason: 'teste' }),
      corpus: store,
      meetings: { list: () => Promise.resolve([]) },
      emptyDir: join(dir, 'vazia'),
      engine: (options) => {
        cwds.push(options.cwd)
        return fakeEngine(() => Promise.resolve({ ok: true, text: 'ok' }))
      },
    })
    await runner.run(request({ meetingId: 'r1' }), () => undefined)
    await runner.run(request({ runId: 'run-2', agent: { ...request().agent, scope: { kind: '7d' } } }), () => undefined)
    await runner.run(request({ runId: 'run-3', agent: { ...request().agent, scope: { kind: 'none' } } }), () => undefined)
    expect(cwds).toEqual([join(dir, 'escopo', 'agent-run-1'), join(dir, 'escopo', 'agent-run-2'), join(dir, 'vazia')])
    expect(existsSync(join(dir, 'vazia'))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(store.dropped).toEqual(['agent-run-1', 'agent-run-2'])
    expect((await runner.run(request({ runId: 'run-4', meetingId: 'sumiu' }), () => undefined)).error).toBe('A reunião do escopo não existe mais.')
    expect(agentSystemPrompt('none', 'x')).toContain('não tem reuniões para ler')
  })

  it('tempo máximo: cancela a sessão, mata o processo 2 s depois e termina como timeout', async () => {
    const handlers: (() => void)[] = []
    const calls: string[] = []
    let resolveAnswer: (answer: ChatAnswer) => void = () => undefined
    const runner = createAgentRunner({
      locate: () => Promise.resolve({ ok: true, path: '/bin/claude', version: '2.0.0' }),
      openAcp: () => () => Promise.resolve<AcpOpenResult>({ ok: false, error: 'failed', reason: 'teste' }),
      corpus: corpus(),
      meetings: { list: () => Promise.resolve([]) },
      emptyDir: join(dir, 'vazia'),
      timers: {
        setTimeout: (handler) => {
          handlers.push(handler)
          return handlers.length
        },
        clearTimeout: () => undefined,
      },
      engine: () => ({
        ...fakeEngine(() => new Promise((resolve) => (resolveAnswer = resolve))),
        stop: () => {
          calls.push('stop')
          return true
        },
        kill: () => {
          calls.push('kill')
          resolveAnswer({ ok: false, error: 'stopped', text: 'parte' })
        },
      }),
    })
    const running = runner.run(request(), () => undefined)
    await new Promise((resolve) => setTimeout(resolve, 10))
    handlers[0]?.()
    expect(calls).toEqual(['stop'])
    handlers[1]?.()
    const result = await running
    expect(calls.slice(0, 2)).toEqual(['stop', 'kill'])
    expect(result).toMatchObject({ status: 'timeout', error: 'Passou do tempo máximo de 30 s.', answer: { error: 'timeout', text: 'parte' } })
  })

  it('saindo do app: o que ainda procura o `claude` não abre sessão', async () => {
    let release: () => void = () => undefined
    let engines = 0
    const runner = createAgentRunner({
      locate: () => new Promise((resolve) => (release = () => resolve({ ok: true, path: '/bin/claude', version: '2.0.0' }))),
      openAcp: () => () => Promise.resolve<AcpOpenResult>({ ok: false, error: 'failed', reason: 'teste' }),
      corpus: corpus(),
      meetings: { list: () => Promise.resolve([]) },
      emptyDir: join(dir, 'vazia'),
      engine: () => {
        engines++
        return fakeEngine(() => Promise.resolve({ ok: true, text: 'ok' }))
      },
    })
    const running = runner.run(request(), () => undefined)
    await new Promise((resolve) => setTimeout(resolve, 5))
    runner.dispose()
    release()
    expect(await running).toMatchObject({ status: 'error', error: 'O app está fechando.' })
    expect(engines).toBe(0)
    expect((await runner.run(request({ runId: 'run-2' }), () => undefined)).error).toBe('O app está fechando.')
  })

  it('modelo que o perfil não oferece e o `claude` que falta: erro, sem abrir sessão', async () => {
    let opened = 0
    const deps = {
      openAcp: () => () => {
        opened++
        return Promise.resolve<AcpOpenResult>({ ok: false, error: 'failed', reason: 'teste' })
      },
      corpus: corpus(),
      meetings: { list: () => Promise.resolve([]) },
      emptyDir: join(dir, 'vazia'),
    }
    const missing = createAgentRunner({ ...deps, locate: () => Promise.resolve({ ok: false, error: 'not-found' }) })
    expect((await missing.run(request(), () => undefined)).error).toBe('Configure o Claude CLI em Configurações.')
    const found = createAgentRunner({ ...deps, locate: () => Promise.resolve({ ok: true, path: '/bin/claude', version: '2.0.0' }) })
    expect((await found.run(request({ agent: { ...request().agent, model: 'fable-5-2' } }), () => undefined)).status).toBe('error')
    expect(opened).toBe(0)
  })
})

function fakeEngine(ask: () => Promise<ChatAnswer>): ChatEngine {
  return { busy: false, alive: true, ask, stop: () => false, kill: () => undefined }
}

describe('saídas (contrato 23, CA6)', () => {
  const answer = { role: 'assistant' as const, text: 'Decidimos manter a captura.', at: '2026-11-16T11:00:00.000Z' }
  const agent = { name: 'Resumo da semana', color: 'green' as const, scope: { kind: '7d' as const }, model: 'sonnet' as const, thinkMore: false }

  function deps(saved: Chat[], notes: Map<string, MeetingNote[]>) {
    return {
      chats: {
        save: (chat: Chat) => {
          saved.push(chat)
          return Promise.resolve(chat)
        },
      },
      notes: {
        append: (id: string, note: MeetingNote) => {
          notes.set(id, [...(notes.get(id) ?? []), note])
          return Promise.resolve(true)
        },
      },
      meetings: { get: (id: string) => Promise.resolve(id === 'r1' ? ({ id } as never) : null) },
      meetingsFolder: () => Promise.resolve(join(dir, 'Reuniões')),
      now: () => new Date(2026, 10, 16, 8, 5).getTime(),
      newId: () => 'novo',
    }
  }

  it('chat: conversa nova no "Assistente" com o pedido e a resposta, marcada "Tarefa: <nome>"', async () => {
    const saved: Chat[] = []
    const text = await applyOutput(deps(saved, new Map()), { output: { kind: 'chat' }, title: 'Tarefa: Sexta', folderName: 'Sexta', agent, prompt: 'Agora…\n\nResuma.', answer, meetingId: null })
    expect(text).toBe('Conversa criada no Assistente')
    expect(saved[0]).toMatchObject({ title: 'Tarefa: Sexta', meetingId: null, scope: { kind: '7d' }, model: 'sonnet', messages: [{ role: 'user', text: 'Agora…\n\nResuma.' }, answer] })
  })

  it('post-it: na reunião que acabou, na cor do agente; sem reunião, falha com o motivo', async () => {
    const notes = new Map<string, MeetingNote[]>()
    await applyOutput(deps([], notes), { output: { kind: 'note' }, title: 'Tarefa: Pendências', folderName: 'Pendências', agent, prompt: 'p', answer, meetingId: 'r1' })
    expect(notes.get('r1')).toEqual([expect.objectContaining({ color: 'green', atMs: null, text: 'Tarefa: Pendências\nDecidimos manter a captura.' })])
    await expect(applyOutput(deps([], notes), { output: { kind: 'note' }, title: 't', folderName: 't', agent, prompt: 'p', answer, meetingId: null })).rejects.toThrow('nenhuma reunião')
  })

  it('post-it do agente + edição pela tela com a lista antiga: os dois ficam; depois de a tela ler, apagar vale', async () => {
    const pending = new Map<string, Set<string>>()
    const store = createFileNotesStore({ dir, keep: (id) => pending.get(id) ?? new Set() })
    const at = '2026-11-16T10:00:00.000Z'
    const mine: MeetingNote = { id: 'minha', text: 'Ligar para a Ana', color: 'yellow', atMs: null, createdAt: at, updatedAt: at }
    await store.save('r1', [mine])
    // A tela leu [minha] e está editando; o agente acrescenta o dele nesse meio tempo.
    await applyOutput(
      { ...deps([], new Map()), notes: store, onNoteSaved: (meetingId, noteId) => pending.set(meetingId, new Set([noteId])) },
      { output: { kind: 'note' }, title: 'Tarefa: Pendências', folderName: 'Pendências', agent, prompt: 'p', answer, meetingId: 'r1' },
    )
    // A tela grava a lista dela (sem o post-it do agente).
    await store.save('r1', [{ ...mine, text: 'Ligar para a Ana amanhã' }])
    expect((await store.get('r1')).map((note) => `${note.id}:${note.text.split('\n')[0]}`)).toEqual(['minha:Ligar para a Ana amanhã', 'novo:Tarefa: Pendências'])
    // A tela relê (o main tira o id da proteção) e exclui o post-it: agora some.
    pending.delete('r1')
    await store.save('r1', [{ ...mine, text: 'Ligar para a Ana amanhã' }])
    expect((await store.get('r1')).map((note) => note.id)).toEqual(['minha'])
  })

  it('arquivo: <pasta>/Agentes/<tarefa>/AAAA-MM-DD HHhMM.md com o nome limpo, sem sobrescrever', async () => {
    const out = deps([], new Map())
    const first = await applyOutput(out, { output: { kind: 'file' }, title: 'Tarefa: Sexta/Semana', folderName: 'Sexta/Semana: ../..', agent, prompt: 'p', answer, meetingId: null })
    const second = await applyOutput(out, { output: { kind: 'file' }, title: 'Tarefa: Sexta/Semana', folderName: 'Sexta/Semana: ../..', agent, prompt: 'p', answer, meetingId: null })
    const folder = join(dir, 'Reuniões', 'Agentes', 'Sexta-Semana- ..-')
    expect(readdirSync(folder).sort()).toEqual(['2026-11-16 08h05 (2).md', '2026-11-16 08h05.md'])
    expect(first).toBe('Arquivo Agentes/Sexta-Semana- ..-/2026-11-16 08h05.md')
    expect(second).toContain('(2).md')
    expect(readFileSync(join(folder, '2026-11-16 08h05.md'), 'utf8')).toContain('# Tarefa: Sexta/Semana\n\n- Agente: Resumo da semana')
    // Nada fora da pasta das reuniões.
    expect(readdirSync(dir).sort()).toEqual(['Reuniões'])
  })

  it('notificação: fica com o serviço (nada é escrito)', async () => {
    mkdirSync(join(dir, 'Reuniões'))
    writeFileSync(join(dir, 'Reuniões', 'x.md'), '')
    expect(await applyOutput(deps([], new Map()), { output: { kind: 'notification' }, title: 't', folderName: 't', agent, prompt: 'p', answer, meetingId: null })).toBe('Notificação do macOS')
    expect(readdirSync(join(dir, 'Reuniões'))).toEqual(['x.md'])
  })
})

describe('agente com "Pode ler o funil" (contrato 115, CA5)', () => {
  const FUNIL = '# Funil de vendas\n\n## Etapas\n\n- Contato (aberta)\n'

  function runnerWith(funilMarkdown: () => Promise<string | null>) {
    const runs: { cwd: string; systemPrompt: string; funilMd: string | null }[] = []
    const store = corpus()
    // Como o acervo de verdade: a pasta do escopo existe quando `scopeMany` devolve.
    store.scopeMany = (_ids, key) => {
      mkdirSync(join(dir, 'escopo', key), { recursive: true })
      return Promise.resolve(join(dir, 'escopo', key))
    }
    const runner = createAgentRunner({
      locate: () => Promise.resolve({ ok: true, path: '/bin/claude', version: '2.0.0' }),
      openAcp: () => () => Promise.resolve<AcpOpenResult>({ ok: false, error: 'failed', reason: 'teste' }),
      corpus: store,
      meetings: { list: () => Promise.resolve([]) },
      emptyDir: join(dir, 'vazia'),
      funilMarkdown,
      engine: (options) => {
        const file = join(options.cwd, 'FUNIL.md')
        runs.push({ cwd: options.cwd, systemPrompt: options.systemPrompt, funilMd: existsSync(file) ? readFileSync(file, 'utf8') : null })
        return fakeEngine(() => Promise.resolve({ ok: true, text: 'ok' }))
      },
    })
    return { runner, runs, store }
  }

  it('com o funil e "todas as reuniões": pasta própria (não o acervo) com o FUNIL.md em 0600 e a linha na instrução; apagada no fim', async () => {
    const { runner, runs, store } = runnerWith(() => Promise.resolve(FUNIL))
    await runner.run(request({ agent: { ...request().agent, funil: true } }), () => undefined)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.cwd).toBe(join(dir, 'escopo', 'agent-run-1'))
    expect(runs[0]?.cwd).not.toBe(store.dir)
    expect(runs[0]?.funilMd).toBe(FUNIL)
    expect(statSync(join(dir, 'escopo', 'agent-run-1', 'FUNIL.md')).mode & 0o777).toBe(0o600)
    expect(runs[0]?.systemPrompt).toContain(FUNIL_INSTRUCAO)
    expect(FUNIL_INSTRUCAO).toBe('Na pasta há FUNIL.md com o funil de vendas (etapas, oportunidades abertas, ganhas e perdidas recentes e contatos). Só leia; não invente oportunidade nem contato.')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(store.dropped).toEqual(['agent-run-1'])
  })

  it('"nenhuma reunião" com o funil também vira pasta própria, nunca a pasta vazia compartilhada', async () => {
    const { runner, runs } = runnerWith(() => Promise.resolve(FUNIL))
    await runner.run(request({ agent: { ...request().agent, scope: { kind: 'none' }, funil: true } }), () => undefined)
    expect(runs[0]?.cwd).toBe(join(dir, 'escopo', 'agent-run-1'))
    expect(runs[0]?.funilMd).toBe(FUNIL)
    expect(existsSync(join(dir, 'vazia', 'FUNIL.md'))).toBe(false)
    expect(runs[0]?.systemPrompt).toContain('Esta execução não tem reuniões para ler; além do pedido, use o FUNIL.md da pasta.')
    expect(runs[0]?.systemPrompt).not.toContain('responda só com base no pedido')
    expect(agentSystemPrompt('none', 'x')).toContain('responda só com base no pedido')
  })

  it('sem o funil roda como antes: o acervo, sem FUNIL.md e a mesma instrução', async () => {
    let asked = 0
    const { runner, runs, store } = runnerWith(() => {
      asked++
      return Promise.resolve(FUNIL)
    })
    await runner.run(request(), () => undefined)
    expect(runs[0]?.cwd).toBe(store.dir)
    expect(runs[0]?.funilMd).toBeNull()
    expect(runs[0]?.systemPrompt).toBe(agentSystemPrompt('all', 'Liste as decisões.', false))
    expect(runs[0]?.systemPrompt).not.toContain('FUNIL.md')
    expect(asked).toBe(0)
  })

  it('o gerador devolvendo null não grava o arquivo nem põe a linha na instrução', async () => {
    const { runner, runs } = runnerWith(() => Promise.resolve(null))
    await runner.run(request({ agent: { ...request().agent, funil: true } }), () => undefined)
    expect(runs[0]?.funilMd).toBeNull()
    expect(runs[0]?.systemPrompt).not.toContain(FUNIL_INSTRUCAO)
  })
})
