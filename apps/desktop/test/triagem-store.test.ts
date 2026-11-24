// Contrato 159 (notificacoes-triagem, CA7): o store de `whatsapp/triagem.json`. Grava e relê, arquivo 0600 com
// `{version: 1, etiquetas}`, quarentena do arquivo ruim, `clear`, `remove` e a poda das etiquetas mais antigas.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTriagemStore } from '../src/main/whatsapp/triagem/store'
import { aplicarAgente, aplicarManual, etiquetaVazia, TRIAGEM_ETIQUETAS_MAX, type Etiqueta } from '../src/shared/triagem'

const NOW = Date.parse('2026-11-23T15:00:00.000Z')
const CHAT = '5511999990000@s.whatsapp.net'
const OUTRO = '5511888880000@s.whatsapp.net'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(dir = mkdtempSync(join(tmpdir(), 'triagem-store-'))) {
  if (!dirs.includes(dir)) dirs.push(dir)
  const logs: string[] = []
  const store = createTriagemStore({ dir, now: () => NOW, devLog: (message) => void logs.push(message) })
  return { dir, file: join(dir, 'triagem.json'), store, logs }
}

describe('store da triagem (contrato 159, CA7)', () => {
  it('diretório vazio vale vazio, sem criar o arquivo', async () => {
    const { store, dir } = setup()
    expect(await store.list()).toEqual({})
    expect(await store.get(CHAT)).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it('set grava e list devolve; num store novo também; arquivo 0600 com version e etiquetas', async () => {
    const { store, dir, file } = setup()
    const etiqueta = aplicarAgente(null, { urgente: true, ambito: 'profissional', motivo: 'prazo hoje' }, 'msg-1', NOW)
    expect(await store.set(CHAT, etiqueta)).toBe(true)
    expect(await store.list()).toEqual({ [CHAT]: etiqueta })
    expect(await store.get(CHAT)).toEqual(etiqueta)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, etiquetas: { [CHAT]: etiqueta } })
    expect(await setup(dir).store.list()).toEqual({ [CHAT]: etiqueta })
  })

  it('a cópia devolvida não muda o store', async () => {
    const { store } = setup()
    await store.set(CHAT, aplicarManual(null, { ambito: 'pessoal' }, NOW))
    const lista = await store.list()
    const copia = lista[CHAT] as Etiqueta
    copia.ambito = 'profissional'
    expect((await store.get(CHAT))?.ambito).toBe('pessoal')
  })

  it('chatId ou etiqueta inválidos não gravam nada', async () => {
    const { store, dir } = setup()
    expect(await store.set('sem-arroba', etiquetaVazia(NOW))).toBe(false)
    expect(await store.set(CHAT, { ...etiquetaVazia(NOW), ambito: 'outro' } as unknown as Etiqueta)).toBe(false)
    expect(await store.set(CHAT, { ...etiquetaVazia(NOW), motivo: 'x'.repeat(161) })).toBe(false)
    expect(readdirSync(dir)).toEqual([])
  })

  it('arquivo inválido vira triagem.json.corrupt-* e a lista parte vazia; o log não leva conteúdo', async () => {
    const { store, dir, file, logs } = setup()
    writeFileSync(file, '{"version":1,"etiquetas":{"x@s.whatsapp.net":{"urgente":"talvez"}}, "segredo": "texto da mensagem"}')
    expect(await store.list()).toEqual({})
    expect(readdirSync(dir)).toEqual([`triagem.json.corrupt-${NOW}`])
    expect(logs).toHaveLength(1)
    expect(logs[0]).not.toContain('texto da mensagem')
    await store.set(CHAT, etiquetaVazia(NOW))
    expect(readdirSync(dir).sort()).toEqual(['triagem.json', `triagem.json.corrupt-${NOW}`])
  })

  it('JSON quebrado também vai para a quarentena', async () => {
    const { store, dir, file } = setup()
    writeFileSync(file, '{ não é json')
    expect(await store.list()).toEqual({})
    expect(readdirSync(dir)).toEqual([`triagem.json.corrupt-${NOW}`])
  })

  it('remove tira só a conversa; clear deixa vazio', async () => {
    const { store, file } = setup()
    await store.set(CHAT, etiquetaVazia(1))
    await store.set(OUTRO, etiquetaVazia(2))
    await store.remove(CHAT)
    expect(Object.keys(await store.list())).toEqual([OUTRO])
    await store.remove('nao-existe@s.whatsapp.net')
    await store.clear()
    expect(await store.list()).toEqual({})
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, etiquetas: {} })
  })

  it('com 2.001 etiquetas, set mantém 2.000 e a mais antiga por `at` sai', async () => {
    const { store, file } = setup()
    const etiquetas: Record<string, Etiqueta> = {}
    for (let i = 0; i < TRIAGEM_ETIQUETAS_MAX; i++) etiquetas[`55119${String(i).padStart(8, '0')}@s.whatsapp.net`] = etiquetaVazia(1_000 + i)
    writeFileSync(file, JSON.stringify({ version: 1, etiquetas }))
    expect(Object.keys(await store.list())).toHaveLength(TRIAGEM_ETIQUETAS_MAX)
    await store.set(CHAT, etiquetaVazia(NOW))
    const depois = await store.list()
    expect(Object.keys(depois)).toHaveLength(2000)
    expect(depois[CHAT]).toBeDefined()
    expect(depois['5511900000000@s.whatsapp.net']).toBeUndefined()
    expect(depois['5511900000001@s.whatsapp.net']).toBeDefined()
  })
})
