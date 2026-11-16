// Autoteste da instalação no app empacotado (contrato 24): com `LAP_REUNIOES_WHATSAPP_INSTALL_TEST=1`, o app não abre
// janela nem toca no `userData`: numa pasta temporária, instala do índice de pacotes falso (`--no-index`, sem rede)
// a partir dos arquivos do serviço que estão dentro do `app.asar`, confere que o `requirements.txt` de verdade saiu do
// `app.asar` e que o `pip` o lê de lá, escreve o resultado em JSON no stdout e sai. Nenhum neonize é instalado.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFakeIndex } from './fake-index'
import { BRIDGE_FILES, installBridge, nodeExec, pythonEnv, PYTHON_CANDIDATES, venvPython, WHATSAPP_PATHS } from './install'

export const INSTALL_TEST_ENV = 'LAP_REUNIOES_WHATSAPP_INSTALL_TEST'

export async function runInstallTest(bridgeSource: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'lap-whatsapp-autoteste-'))
  const root = join(dir, 'whatsapp')
  const report: Record<string, unknown> = { bridgeSource, insideAsar: bridgeSource.includes('.asar') }
  try {
    const fake = writeFakeIndex(join(dir, 'indice'))
    const installed = await installBridge({
      root,
      exec: nodeExec,
      pythonCandidates: PYTHON_CANDIDATES,
      bridgeSource,
      bridgeFiles: BRIDGE_FILES,
      requirements: fake.requirements,
      index: { kind: 'local', dir: fake.indexDir },
      baseEnv: process.env,
      onProgress: () => undefined,
    })
    report['install'] = installed.ok ? { ok: true, python: installed.python.version } : installed
    const copied = join(root, WHATSAPP_PATHS.bridge, 'requirements.txt')
    const bundled = readFileSync(join(bridgeSource, 'requirements.txt'), 'utf8')
    const copiedText = readFileSync(copied, 'utf8')
    report['copiedEqualsBundled'] = copiedText === bundled && bundled.includes('neonize==0.10.0')
    // O `pip` lê a cópia: sem rede e sem os pacotes no índice falso, ele para no primeiro pacote da lista (prova de
    // que leu o arquivo); o caminho de dentro do `app.asar` ele nem abre.
    const pip = (requirements: string) =>
      nodeExec(venvPython(root), ['-I', '-m', 'pip', 'install', '--dry-run', '--isolated', '--disable-pip-version-check', '--no-input', '--require-hashes', '--only-binary=:all:', '--no-index', '--find-links', fake.indexDir, '-r', requirements], { timeoutMs: 120_000, env: pythonEnv(process.env) })
    const fromCopy = await pip(copied)
    const fromAsar = await pip(join(bridgeSource, 'requirements.txt'))
    const copyErr = fromCopy.ok ? '' : fromCopy.stderr
    const asarErr = fromAsar.ok ? '' : fromAsar.stderr
    report['pipReadsCopy'] = !fromCopy.ok && /anyio==4\.16\.0|No matching distribution/i.test(copyErr) && !/Could not open requirements file/i.test(copyErr)
    report['pipCannotReadAsar'] = !fromAsar.ok && /Could not open requirements file/i.test(asarErr)
    const ok = installed.ok && report['copiedEqualsBundled'] === true && report['pipReadsCopy'] === true
    report['ok'] = ok
    process.stdout.write(`${JSON.stringify(report)}\n`)
    return ok ? 0 : 1
  } catch (error) {
    report['error'] = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${JSON.stringify(report)}\n`)
    return 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
