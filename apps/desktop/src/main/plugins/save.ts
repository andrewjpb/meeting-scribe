// "Salvar plugin…" (contrato 31): o diálogo de escolher pasta no main e a cópia da extensão embutida para
// `<pasta escolhida>/LAP Reunioes - <nome>/`. A origem vive dentro do `app.asar` no app empacotado, por isso a cópia
// é arquivo a arquivo (`readdir` + `copyFile`), nunca recursiva. Salvar de novo troca os arquivos (atualiza o
// plugin); um link simbólico no lugar da pasta ou de um arquivo é recusado.
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { APP_PLUGIN_IDS, APP_PLUGINS, pluginFolderName, type AppPlugin, type AppPluginId, type PluginSaveResult } from '../../shared/plugins'
import type { FolderDialog } from '../audio-files/service'

export interface PluginSaveDeps {
  /** Pasta embutida do plugin (dev: a do repositório; empacotado: dentro do `app.asar`). */
  sourceDir(id: AppPluginId): string
  dialog: FolderDialog
  /** Pasta em que o diálogo abre (Downloads). */
  defaultFolder: string
}

const saveSchema = z.object({ id: z.enum(APP_PLUGIN_IDS) })

async function isSymlink(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null)
  return info?.isSymbolicLink() ?? false
}

async function copyPlugin(plugin: AppPlugin, from: string, folder: string): Promise<void> {
  const present = new Set(await readdir(from))
  const missing = plugin.arquivos.filter((name) => !present.has(name))
  if (missing.length > 0) throw new Error(`plugin incompleto: ${missing.join(', ')}`)
  if (await isSymlink(folder)) throw new Error('a pasta do plugin é um link')
  await mkdir(folder, { recursive: true })
  if (!(await lstat(folder)).isDirectory()) throw new Error('o caminho do plugin não é uma pasta')
  for (const name of plugin.arquivos) {
    const target = join(folder, name)
    if (await isSymlink(target)) throw new Error(`${name} é um link`)
    await copyFile(join(from, name), target)
  }
}

export function createPluginSave(deps: PluginSaveDeps): (input: unknown) => Promise<PluginSaveResult> {
  return async (input) => {
    const parsed = saveSchema.safeParse(input)
    if (!parsed.success) return { ok: false }
    const plugin = APP_PLUGINS.find((candidate) => candidate.id === parsed.data.id)
    if (!plugin) return { ok: false }
    const chosen = await deps.dialog.chooseFolder(deps.defaultFolder)
    if (!chosen || !isAbsolute(chosen)) return null
    const folder = join(resolve(chosen), pluginFolderName(plugin))
    try {
      await copyPlugin(plugin, deps.sourceDir(plugin.id), folder)
      return { ok: true, path: folder }
    } catch {
      return { ok: false }
    }
  }
}
