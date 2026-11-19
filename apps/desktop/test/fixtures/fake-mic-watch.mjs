// `lap-mic-watch` falso (contrato 49) para o smoke e o teste do processo: fala o mesmo protocolo do binário de verdade
// (native/mic-watch/main.swift), uma linha JSON por mudança no stdout, e sai quando o stdin fecha. Não abre microfone
// nem câmera.
// - Sem variáveis: só a linha inicial, microfone desligado.
// - `FAKE_MIC_WATCH_LINES`: um array JSON de linhas (texto) escritas no lugar da inicial, na ordem.
// - `FAKE_MIC_WATCH_EXIT=<código>`: sai com esse código logo depois das linhas (o teste do recuo).
// - `FAKE_MIC_WATCH_FILE=<arquivo>`: cada linha nova acrescentada ao arquivo vai para o stdout (o smoke "liga o
//   microfone do Zoom" escrevendo nele).
//
// Uso: node fake-mic-watch.mjs | node fake-mic-watch.mjs --version
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'
import { setInterval } from 'node:timers'

if (process.argv.includes('--version')) {
  process.stdout.write('lap-mic-watch 1 (falso)\n')
  process.exit(0)
}

const INITIAL = JSON.stringify({ apps: [], camera: false, mic: false, names: {}, v: 1 })
const lines = process.env['FAKE_MIC_WATCH_LINES'] ? JSON.parse(process.env['FAKE_MIC_WATCH_LINES']) : [INITIAL]
for (const line of lines) process.stdout.write(`${line}\n`)

const exitCode = process.env['FAKE_MIC_WATCH_EXIT']
if (exitCode !== undefined) process.exit(Number(exitCode))

const file = process.env['FAKE_MIC_WATCH_FILE']
if (file) {
  let sent = 0
  setInterval(() => {
    if (!existsSync(file)) return
    const all = readFileSync(file, 'utf8').split('\n')
    // A última parte, sem "\n", ainda está sendo escrita.
    const complete = all.slice(0, -1)
    for (const line of complete.slice(sent)) if (line.trim()) process.stdout.write(`${line}\n`)
    sent = complete.length
  }, 50)
}

// O app morreu (ou parou o observador): o stdin fecha e o processo sai.
process.stdin.on('end', () => process.exit(0))
process.stdin.on('close', () => process.exit(0))
process.stdin.resume()
