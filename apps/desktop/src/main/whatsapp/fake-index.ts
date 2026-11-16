// Índice de pacotes falso do smoke (contrato 24, CA7): uma pasta local com um wheel mínimo e o `requirements.txt`
// com o hash dele, para "Instalar" rodar o `venv` e o `pip install --require-hashes` de verdade sem rede nenhuma e
// sem o neonize. O wheel é montado aqui (zip sem compressão), sem ferramenta de fora.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'

export const FAKE_PACKAGE = 'lap-whatsapp-smoke'
export const FAKE_PACKAGE_VERSION = '0.0.1'

/** Zip sem compressão (método 0): o suficiente para um wheel. */
export function storedZip(files: readonly { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const data = Buffer.from(file.content, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(0, 30)
    central.writeUInt32LE(0, 34)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex')
const recordHash = (content: string): string => `sha256=${createHash('sha256').update(content).digest('base64url')}`

/** Escreve o wheel e o `requirements.txt` em `dir`. */
export function writeFakeIndex(dir: string): { indexDir: string; requirements: string } {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const module = FAKE_PACKAGE.replace(/-/g, '_')
  const info = `${module}-${FAKE_PACKAGE_VERSION}.dist-info`
  const body = [
    { name: `${module}/__init__.py`, content: `# Pacote falso do smoke do LAP Reuniões: nada aqui fala com o WhatsApp.\nVERSION = '${FAKE_PACKAGE_VERSION}'\n` },
    { name: `${info}/METADATA`, content: `Metadata-Version: 2.1\nName: ${FAKE_PACKAGE}\nVersion: ${FAKE_PACKAGE_VERSION}\nSummary: Pacote falso do smoke\n` },
    { name: `${info}/WHEEL`, content: 'Wheel-Version: 1.0\nGenerator: lap-reunioes-smoke\nRoot-Is-Purelib: true\nTag: py3-none-any\n' },
  ]
  const record = [...body.map((file) => `${file.name},${recordHash(file.content)},${Buffer.byteLength(file.content)}`), `${info}/RECORD,,`].join('\n')
  const wheel = storedZip([...body, { name: `${info}/RECORD`, content: `${record}\n` }])
  const indexDir = join(dir, 'pacotes')
  mkdirSync(indexDir, { recursive: true, mode: 0o700 })
  writeFileSync(join(indexDir, `${module}-${FAKE_PACKAGE_VERSION}-py3-none-any.whl`), wheel)
  const requirements = join(dir, 'requirements.txt')
  writeFileSync(requirements, `${FAKE_PACKAGE}==${FAKE_PACKAGE_VERSION} \\\n    --hash=sha256:${sha256(wheel)}\n`)
  return { indexDir, requirements }
}
