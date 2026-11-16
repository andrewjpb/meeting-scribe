// Roda o smoke (`electron . --smoke`) com um userData temporário criado aqui e apagado depois que o
// Electron sai: o Chromium ainda grava no perfil durante o encerramento, então o próprio app não
// consegue apagá-lo por inteiro.
import { spawn } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const userData = realpathSync(mkdtempSync(join(tmpdir(), 'meeting-scribe-smoke-')))

const child = spawn(electron, [appDir, '--smoke', `--smoke-user-data=${userData}`], { stdio: 'inherit' })
child.on('exit', (code, signal) => {
  rmSync(userData, { recursive: true, force: true })
  process.exit(signal ? 1 : (code ?? 1))
})
