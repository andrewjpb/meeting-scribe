// Contrato 165 (pastas-assistente): a varredura numa pasta de verdade (CA3), o índice com o mapa id → arquivo de cada
// conversa e o cache (CA6) e os canais de adicionar e remover pasta (CA10), com uma pasta temporária.
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, symlinkSync, writeFileSync, ftruncateSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addAssistantFolders, createFolderIndex, folderFileId, removeAssistantFolder, scanFolder, type FolderChannelDeps } from '../src/main/chat/folders'
import { ASSISTANT_FOLDERS_MAX, type AssistantFolder } from '../src/shared/assistant-folders'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fsPromises>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

let dir: string
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pastas-')))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.mocked(fsPromises.readdir).mockClear()
})

const folderAt = (path: string, id = 'f1'): AssistantFolder => ({ id, path, addedAt: '2026-11-23T10:00:00.000Z' })

/** A pasta do CA3: três arquivos que entram e o que fica de fora (fundo demais, oculto, link, grande, outro tipo). */
function seed(root: string): void {
  const write = (rel: string, content = 'x'): void => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  write('a/b/c/d/e/f/g/fundo.txt')
  write('Contratos/c1.pdf', '%PDF-1.4')
  write('Planilhas/p.xlsx')
  write('.oculto/s.txt')
  write('Apresentacoes/i.pptx')
  write('video.mp4')
  symlinkSync('/etc', join(root, 'link'))
  const big = openSync(join(root, 'grande.bin'), 'w')
  ftruncateSync(big, 21 * 1024 * 1024)
  closeSync(big)
}

describe('varredura de uma pasta (CA3)', () => {
  it('só os anexáveis até a profundidade 6; oculto, link, grande e outro tipo ficam de fora', async () => {
    seed(dir)
    const scan = await scanFolder(folderAt(dir), { deadline: Date.now() + 60_000, maxEntries: 2000 })
    expect(scan.entries.map((entry) => entry.relPath)).toEqual(['Apresentacoes/i.pptx', 'Contratos/c1.pdf', 'Planilhas/p.xlsx'])
    expect(scan.skipped).toBe(3)
    expect(scan.truncated).toBe(false)
    expect(scan.partial).toBe(false)
    const pptx = scan.entries[0]
    expect(pptx).toMatchObject({ id: folderFileId('f1', 'Apresentacoes/i.pptx'), folderId: 'f1', name: 'i.pptx', ext: 'pptx', kind: 'anexo', readable: false, size: 1 })
    expect(scan.entries[1]).toMatchObject({ kind: 'pdf', readable: true, size: 8 })
    expect(scan.label).toBe(dir.split('/').pop())
  })

  it('no limite de arquivos, truncada; no limite de tempo, parcial', async () => {
    seed(dir)
    const truncated = await scanFolder(folderAt(dir), { deadline: Date.now() + 60_000, maxEntries: 2 })
    expect(truncated.entries).toHaveLength(2)
    expect(truncated.truncated).toBe(true)
    const late = await scanFolder(folderAt(dir), { deadline: Date.now() - 1, maxEntries: 2000 })
    expect(late.partial).toBe(true)
    expect(late.entries).toEqual([])
  })

  it('a raiz trocada por um link, ou que não é mais o caminho gravado: nada é varrido, parcial', async () => {
    const real = join(dir, 'Real')
    mkdirSync(real)
    writeFileSync(join(real, 'nota.md'), 'x')
    symlinkSync(real, join(dir, 'Atalho'))
    const linked = await scanFolder(folderAt(join(dir, 'Atalho')), { deadline: Date.now() + 60_000, maxEntries: 2000 })
    expect(linked).toMatchObject({ entries: [], partial: true })
    // Uma pasta comum debaixo do link também não: o caminho real é outro.
    const viaLink = await scanFolder(folderAt(`${dir}/Atalho/Sub`), { deadline: Date.now() + 60_000, maxEntries: 2000 })
    mkdirSync(join(real, 'Sub'))
    expect((await scanFolder(folderAt(`${dir}/Atalho/Sub`), { deadline: Date.now() + 60_000, maxEntries: 2000 })).partial).toBe(true)
    expect(viaLink).toMatchObject({ entries: [], partial: true })
    expect((await scanFolder(folderAt(real), { deadline: Date.now() + 60_000, maxEntries: 2000 })).entries).toHaveLength(1)
  })

  it('pacotes do macOS, node_modules e o ícone do Finder ficam de fora sem contar', async () => {
    mkdirSync(join(dir, 'App.app'))
    writeFileSync(join(dir, 'App.app', 'leia.txt'), 'x')
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'x.md'), 'x')
    writeFileSync(join(dir, 'Icon\r'), '')
    writeFileSync(join(dir, 'nota.md'), 'x')
    const scan = await scanFolder(folderAt(dir), { deadline: Date.now() + 60_000, maxEntries: 2000 })
    expect(scan.entries.map((entry) => entry.relPath)).toEqual(['nota.md'])
    expect(scan.skipped).toBe(0)
  })
})

describe('índice das pastas e mapa por conversa (CA6)', () => {
  it('lista vazia: null e nada resolve; com pasta: o texto e o id só na conversa que recebeu o índice', async () => {
    seed(dir)
    let folders: AssistantFolder[] = []
    let clock = 1_000_000
    const index = createFolderIndex({ settings: async () => folders, home: '/Users/ninguem', now: () => clock })
    const c1 = folderFileId('f1', 'Contratos/c1.pdf')
    expect(await index.markdown('c1')).toBeNull()
    expect(index.resolve('c1', c1)).toBeNull()

    folders = [folderAt(dir)]
    const text = await index.markdown('c1')
    expect(text).toContain('# Pastas permitidas')
    expect(text).toContain(`| ${c1} | Contratos/c1.pdf | pdf |`)
    expect(index.resolve('c1', c1)).toMatchObject({ relPath: 'Contratos/c1.pdf', folderId: 'f1' })
    expect(index.folderOf(index.resolve('c1', c1) as never)).toEqual(folders[0])
    expect(index.resolve('c2', c1)).toBeNull()
    expect(index.resolve('c1', 'ffffffffffffffff')).toBeNull()

    // Dentro de 30 s, sem varrer de novo (nem para outra conversa).
    const readdir = vi.mocked(fsPromises.readdir)
    const calls = readdir.mock.calls.length
    clock += 29_000
    await index.markdown('c2')
    expect(readdir.mock.calls.length).toBe(calls)
    expect(index.resolve('c2', c1)).not.toBeNull()
    // Depois de 30 s, varre.
    clock += 2_000
    await index.markdown('c1')
    expect(readdir.mock.calls.length).toBeGreaterThan(calls)
    // `invalidate` força a varredura; o mapa da conversa fica até a próxima gravação.
    const after = readdir.mock.calls.length
    index.invalidate()
    expect(index.resolve('c1', c1)).not.toBeNull()
    await index.markdown('c1')
    expect(readdir.mock.calls.length).toBeGreaterThan(after)
    // Outra lista (a pasta removida) também varre de novo, e a pasta removida não resolve mais.
    index.forget('c1')
    expect(index.resolve('c1', c1)).toBeNull()
    folders = []
    expect(await index.markdown('c2')).toBeNull()
    expect(index.resolve('c2', c1)).toBeNull()
  })

  it('a pasta que sumiu sai vazia e parcial; o teto de arquivos vale para o total', async () => {
    seed(dir)
    const gone = folderAt(join(dir, 'nao-existe'), 'f9')
    const index = createFolderIndex({ settings: async () => [gone, folderAt(dir)], home: '/Users/ninguem' })
    const [first, second] = await index.scans()
    expect(first).toMatchObject({ folderId: 'f9', entries: [], partial: true })
    expect(second?.entries).toHaveLength(3)
    expect(await index.markdown('c1')).toContain('varredura interrompida: lista parcial.')
  })
})

describe('canais de adicionar e remover pasta (CA10)', () => {
  /** A pasta temporária do macOS fica em /private/var (sensível): as pastas escolhidas ficam na raiz do smoke. */
  function channel(chosen: () => string[]) {
    let saved: AssistantFolder[] = []
    const invalidate = vi.fn()
    const dropMedia = vi.fn(async () => undefined)
    let n = 0
    const deps: FolderChannelDeps = {
      choose: async () => chosen(),
      update: async (change) => {
        saved = change(saved)
      },
      context: async () => ({ home: dir, userData: '/Users/ninguem/Library/Application Support/App', smokeRoot: join(dir, 'smoke-pastas') }),
      invalidate,
      dropMedia,
      newId: () => `id-${++n}`,
      now: () => new Date('2026-11-23T10:00:00.000Z'),
    }
    return { deps, invalidate, dropMedia, saved: () => saved }
  }

  it('a pasta pessoal é sensível, a de dentro de uma escolhida é repetida; escolher de novo é repetida; remover apaga as cópias', async () => {
    const docs = join(dir, 'smoke-pastas', 'Docs')
    const sub = join(docs, 'Sub')
    mkdirSync(sub, { recursive: true })
    let chosen = [dir, docs, sub]
    const { deps, invalidate, dropMedia, saved } = channel(() => chosen)

    const first = await addAssistantFolders(deps)
    expect(first.added).toEqual([{ id: 'id-1', path: docs, addedAt: '2026-11-23T10:00:00.000Z' }])
    expect(first.refused).toEqual([
      { path: dir, reason: 'sensivel' },
      { path: sub, reason: 'repetida' },
    ])
    expect(first.replaced).toEqual([])
    expect(saved()).toEqual(first.added)
    expect(invalidate).toHaveBeenCalledTimes(1)

    chosen = [docs]
    const second = await addAssistantFolders(deps)
    expect(second).toEqual({ added: [], refused: [{ path: docs, reason: 'repetida' }], replaced: [] })

    expect(await removeAssistantFolder(deps, { id: 'id-1' })).toEqual({ ok: true })
    expect(saved()).toEqual([])
    expect(dropMedia).toHaveBeenCalledTimes(1)
    expect(await removeAssistantFolder(deps, { id: 'falso' })).toEqual({ ok: false })
    expect(await removeAssistantFolder(deps, null)).toEqual({ ok: false })
    expect(dropMedia).toHaveBeenCalledTimes(1)
  })

  it('inexistente, a que engloba outras (substitui) e o teto de pastas; cancelar não grava', async () => {
    const base = join(dir, 'smoke-pastas')
    const outer = join(base, 'Docs')
    const inner = join(outer, 'Sub')
    mkdirSync(inner, { recursive: true })
    writeFileSync(join(base, 'arquivo.txt'), 'x')
    let chosen: string[] = [inner, join(base, 'nao-existe'), join(base, 'arquivo.txt')]
    const { deps, saved } = channel(() => chosen)
    const first = await addAssistantFolders(deps)
    expect(first.added.map((folder) => folder.path)).toEqual([inner])
    expect(first.refused.map((item) => item.reason)).toEqual(['inexistente', 'inexistente'])

    chosen = [outer]
    const second = await addAssistantFolders(deps)
    expect(second.added.map((folder) => folder.path)).toEqual([outer])
    expect(second.replaced).toEqual([inner])
    expect(saved().map((folder) => folder.path)).toEqual([outer])

    const many = Array.from({ length: ASSISTANT_FOLDERS_MAX + 1 }, (_, i) => join(base, `P${String(i).padStart(2, '0')}`))
    for (const path of many) mkdirSync(path)
    chosen = many
    const third = await addAssistantFolders(deps)
    expect(third.added).toHaveLength(ASSISTANT_FOLDERS_MAX - 1)
    expect(third.refused).toEqual(many.slice(ASSISTANT_FOLDERS_MAX - 1).map((path) => ({ path, reason: 'limite' })))
    expect(saved()).toHaveLength(ASSISTANT_FOLDERS_MAX)

    chosen = []
    const update = vi.spyOn(deps, 'update')
    expect(await addAssistantFolders(deps)).toEqual({ added: [], refused: [], replaced: [] })
    expect(update).not.toHaveBeenCalled()
  })
})
