// Plugins no app (contrato 31, CA2): "Salvar plugin…" copia a extensão embutida, arquivo a arquivo, para
// `<pasta escolhida>/LAP Reunioes - <nome>/`. Diálogo substituto e pastas temporárias; a origem é a extensão de
// verdade do repositório (a mesma que o pack.sh embute). Contrato 46: e a do "Controle do navegador".
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPluginSave } from '../src/main/plugins/save'
import { APP_PLUGINS, pluginFolderName, type AppPlugin } from '../src/shared/plugins'

const MEET_SOURCE = join(__dirname, '..', '..', '..', 'extensions', 'meet')
const MEET = ((): AppPlugin => {
  const plugin = APP_PLUGINS.find((candidate) => candidate.id === 'meet')
  if (!plugin) throw new Error('plugin do Meet fora do registro')
  return plugin
})()
const NAVEGADOR_SOURCE = join(__dirname, '..', '..', '..', 'extensions', 'navegador')
const NAVEGADOR = ((): AppPlugin => {
  const plugin = APP_PLUGINS.find((candidate) => candidate.id === 'navegador')
  if (!plugin) throw new Error('plugin do navegador fora do registro')
  return plugin
})()

let root: string
let chosen: string | null
let target: string
let dialogs: string[]

function save(sourceDir = MEET_SOURCE) {
  return createPluginSave({
    sourceDir: () => sourceDir,
    dialog: {
      chooseFolder: (defaultPath) => {
        dialogs.push(defaultPath)
        return Promise.resolve(chosen)
      },
    },
    defaultFolder: join(root, 'Downloads'),
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'scribe-plugins-'))
  target = join(root, 'escolhida')
  mkdirSync(target)
  chosen = target
  dialogs = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('registro de plugins', () => {
  it('o Meet, para o Chrome, com os 4 arquivos da extensão', () => {
    expect(APP_PLUGINS.map((plugin) => plugin.id)).toEqual(['meet', 'navegador'])
    expect(MEET).toMatchObject({ nome: 'Quem fala no Meet', navegador: 'Google Chrome', arquivos: ['manifest.json', 'content.js', 'background.js', 'README.md'] })
    expect(pluginFolderName(MEET)).toBe('LAP Reunioes - Quem fala no Meet')
    for (const name of MEET.arquivos) expect(existsSync(join(MEET_SOURCE, name)), name).toBe(true)
  })

  it('o Controle do navegador (contrato 46), para o Chrome, com os 3 arquivos da extensão, sem content script', () => {
    expect(NAVEGADOR).toMatchObject({ nome: 'Controle do navegador', navegador: 'Google Chrome', arquivos: ['manifest.json', 'background.js', 'README.md'] })
    expect(pluginFolderName(NAVEGADOR)).toBe('LAP Reunioes - Controle do navegador')
    for (const name of NAVEGADOR.arquivos) expect(existsSync(join(NAVEGADOR_SOURCE, name)), name).toBe(true)
    const manifest = JSON.parse(readFileSync(join(NAVEGADOR_SOURCE, 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({ manifest_version: 3, permissions: ['tabs', 'scripting', 'storage'], host_permissions: ['<all_urls>', 'http://127.0.0.1/*'] })
    expect(manifest['content_scripts']).toBeUndefined()
    expect(JSON.stringify(manifest)).not.toContain('debugger')
  })
})

describe('Salvar plugin… (CA2)', () => {
  it('copia todos os arquivos para a pasta do plugin dentro da escolhida', async () => {
    const result = await save()({ id: 'meet' })
    const folder = join(target, 'LAP Reunioes - Quem fala no Meet')
    expect(result).toEqual({ ok: true, path: folder })
    expect(dialogs).toEqual([join(root, 'Downloads')])
    for (const name of MEET.arquivos) expect(readFileSync(join(folder, name), 'utf8'), name).toBe(readFileSync(join(MEET_SOURCE, name), 'utf8'))
  })

  it('o Controle do navegador copia a pasta real extensions/navegador (contrato 46)', async () => {
    const result = await save(NAVEGADOR_SOURCE)({ id: 'navegador' })
    const folder = join(target, 'LAP Reunioes - Controle do navegador')
    expect(result).toEqual({ ok: true, path: folder })
    for (const name of NAVEGADOR.arquivos) expect(readFileSync(join(folder, name), 'utf8'), name).toBe(readFileSync(join(NAVEGADOR_SOURCE, name), 'utf8'))
  })

  it('salvar de novo troca os arquivos (atualiza o plugin)', async () => {
    const folder = join(target, pluginFolderName(MEET))
    mkdirSync(folder)
    writeFileSync(join(folder, 'manifest.json'), 'velho')
    expect(await save()({ id: 'meet' })).toEqual({ ok: true, path: folder })
    expect(readFileSync(join(folder, 'manifest.json'), 'utf8')).toBe(readFileSync(join(MEET_SOURCE, 'manifest.json'), 'utf8'))
  })

  it('id desconhecido ou pedido estranho é recusado sem abrir o diálogo', async () => {
    for (const input of [{ id: 'teams' }, { id: '../meet' }, {}, undefined, 'meet']) expect(await save()(input)).toEqual({ ok: false })
    expect(dialogs).toEqual([])
  })

  it('cancelar o diálogo não grava nada', async () => {
    chosen = null
    expect(await save()({ id: 'meet' })).toBeNull()
    expect(existsSync(join(root, 'escolhida', pluginFolderName(MEET)))).toBe(false)
  })

  it('recusa escrever por um link simbólico', async () => {
    const outside = join(root, 'fora.txt')
    writeFileSync(outside, 'intocado')
    const folder = join(target, pluginFolderName(MEET))
    mkdirSync(folder)
    symlinkSync(outside, join(folder, 'content.js'))
    expect(await save()({ id: 'meet' })).toEqual({ ok: false })
    expect(readFileSync(outside, 'utf8')).toBe('intocado')
  })

  it('origem incompleta falha sem criar a pasta', async () => {
    const partial = join(root, 'parcial')
    mkdirSync(partial)
    writeFileSync(join(partial, 'manifest.json'), '{}')
    expect(await save(partial)({ id: 'meet' })).toEqual({ ok: false })
    expect(existsSync(join(target, pluginFolderName(MEET)))).toBe(false)
  })
})
