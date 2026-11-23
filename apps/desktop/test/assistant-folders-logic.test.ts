// Contrato 165 (pastas-assistente): as regras puras das pastas do Assistente. Os tipos que entram no índice (CA1), as
// pastas recusadas e as substituídas (CA2), o id de cada arquivo (CA4) e o texto do `PASTAS.md` (CA5).
import { describe, expect, it } from 'vitest'
import { folderFileId } from '../src/main/chat/folders'
import { fileKindOf, folderLabel, folderRefusal, foldersReplacedBy, renderPastasIndex, shortenHome, type AssistantFolder, type FolderFileEntry, type FolderScan } from '../src/shared/assistant-folders'

describe('tipos do índice (CA1)', () => {
  it('legíveis, só anexo e fora do índice, pela extensão sem diferença de maiúscula', () => {
    expect(fileKindOf('Contrato.PDF')).toEqual({ kind: 'pdf', readable: true })
    expect(fileKindOf('a.docx')).toEqual({ kind: 'word', readable: true })
    expect(fileKindOf('a.xlsx')).toEqual({ kind: 'planilha', readable: true })
    expect(fileKindOf('a.csv')).toEqual({ kind: 'texto', readable: true })
    expect(fileKindOf('a.md')).toEqual({ kind: 'texto', readable: true })
    expect(fileKindOf('foto.JPEG')).toEqual({ kind: 'imagem', readable: true })
    expect(fileKindOf('a.pptx')).toEqual({ kind: 'anexo', readable: false })
    expect(fileKindOf('a.numbers')).toEqual({ kind: 'anexo', readable: false })
    for (const name of ['a.zip', 'a.mp4', 'sem-extensao', 'termina.', '.md', 'a.constructor', 'a.toString']) expect(fileKindOf(name)).toBeNull()
  })
})

describe('pastas recusadas (CA2)', () => {
  const home = '/Users/x'
  const userData = '/Users/x/Library/Application Support/App'
  const folder = (path: string, id = path): AssistantFolder => ({ id, path, addedAt: '2026-11-23T10:00:00.000Z' })
  const refusal = (path: string, existing: AssistantFolder[] = []) => folderRefusal(path, { home, userData, existing })

  it('sensível: as raízes do sistema, a pasta pessoal inteira, ~/Library e a pasta de dados do app', () => {
    expect(refusal('/Users/x')).toBe('sensivel')
    // As que contêm a pasta pessoal ou a de dados do app também.
    expect(refusal('/Users')).toBe('sensivel')
    expect(refusal('/Users/x/Library/Application Support')).toBe('sensivel')
    expect(folderRefusal('/Dados', { home, userData: '/Dados/App', existing: [] })).toBe('sensivel')
    expect(folderRefusal('/Dados/Outra', { home, userData: '/Dados/App', existing: [] })).toBeNull()
    expect(refusal('/Users/x/Library')).toBe('sensivel')
    expect(refusal('/Users/x/Library/Mail')).toBe('sensivel')
    expect(refusal('/')).toBe('sensivel')
    expect(refusal('/Volumes')).toBe('sensivel')
    expect(refusal('/Applications')).toBe('sensivel')
    expect(refusal('/private/var/folders/x')).toBe('sensivel')
    expect(refusal('/usr/local/share')).toBe('sensivel')
    expect(refusal(userData)).toBe('sensivel')
    expect(refusal(`${userData}/chat-scope`)).toBe('sensivel')
    // Um volume específico pode; um nome que só começa igual também.
    expect(refusal('/Volumes/Disco/Docs')).toBeNull()
    expect(refusal('/Users/x/Librarys')).toBeNull()
    expect(refusal('/Users/x/Documents')).toBeNull()
  })

  it('smokeRoot (só o smoke): dentro dele pula só a etapa sensível; oculta e repetida continuam', () => {
    const smokeRoot = '/private/var/t/smoke-pastas'
    const withRoot = (path: string, existing: AssistantFolder[] = []) => folderRefusal(path, { home, userData, existing, smokeRoot })
    expect(withRoot('/private/var/t/smoke-pastas/pasta-exemplo')).toBeNull()
    expect(refusal('/private/var/t/smoke-pastas/pasta-exemplo')).toBe('sensivel')
    expect(withRoot('/private/var/t/smoke-pastas/.oculto')).toBe('oculta')
    expect(withRoot('/private/var/t/smoke-pastas/pasta-exemplo/Sub', [folder('/private/var/t/smoke-pastas/pasta-exemplo')])).toBe('repetida')
    // Fora dele, nada muda.
    expect(withRoot('/private/var/t')).toBe('sensivel')
    expect(withRoot('/Users/x')).toBe('sensivel')
  })

  it('oculta: qualquer segmento começando com ponto', () => {
    expect(refusal('/Users/x/.ssh')).toBe('oculta')
    expect(refusal('/Users/x/Docs/.git/x')).toBe('oculta')
  })

  it('repetida: a mesma ou dentro de uma da lista; a que engloba outras entra e as de dentro saem', () => {
    const docs = folder('/Users/x/Docs')
    expect(refusal('/Users/x/Docs', [docs])).toBe('repetida')
    expect(refusal('/Users/x/Docs/Sub', [docs])).toBe('repetida')
    expect(refusal('/Users/x/Docs2', [docs])).toBeNull()
    const sub = folder('/Users/x/Docs/Sub')
    const other = folder('/Users/x/Outra')
    expect(refusal('/Users/x/Docs', [sub, other])).toBeNull()
    expect(foldersReplacedBy('/Users/x/Docs', [sub, other])).toEqual([sub])
    expect(foldersReplacedBy('/Users/x/Docs', [docs])).toEqual([])
  })

  it('o nome e o caminho curto da pasta', () => {
    expect(folderLabel('/Users/x/Documents/LAP/Documentos')).toBe('Documentos')
    expect(folderLabel('/Volumes/Disco/')).toBe('Disco')
    expect(shortenHome('/Users/x/Documents/LAP', home)).toBe('~/Documents/LAP')
    expect(shortenHome('/Users/xy/Docs', home)).toBe('/Users/xy/Docs')
    expect(shortenHome('/Volumes/Disco', home)).toBe('/Volumes/Disco')
  })
})

describe('id de cada arquivo (CA4)', () => {
  it('16 hex, estável, e muda com o caminho ou com a pasta', () => {
    const id = folderFileId('f1', 'Contratos/c1.pdf')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(folderFileId('f1', 'Contratos/c1.pdf')).toBe(id)
    expect(folderFileId('f1', 'Contratos/c2.pdf')).not.toBe(id)
    expect(folderFileId('f2', 'Contratos/c1.pdf')).not.toBe(id)
  })
})

describe('texto do PASTAS.md (CA5)', () => {
  const entry = (folderId: string, relPath: string, size: number, readable = true): FolderFileEntry => {
    const name = relPath.split('/').pop() as string
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    return { id: folderFileId(folderId, relPath), folderId, relPath, name, ext, kind: readable ? 'pdf' : 'anexo', readable, size, mtime: new Date(2026, 9, 2, 15, 30).getTime() }
  }
  const scans: FolderScan[] = [
    {
      folderId: 'f1',
      label: 'Documentos',
      path: '/Users/x/Documents/LAP/Documentos',
      entries: [entry('f1', 'Contratos/Contrato-ABF-2026.pdf', 1_258_291), entry('f1', 'Apresentacoes/LAP.pptx', 245_760, false), entry('f1', 'Nome | com `crase`\ne quebra.pdf', 512)],
      skipped: 4,
      truncated: true,
      partial: false,
    },
    { folderId: 'f2', label: 'Docs', path: '/Volumes/Disco/Docs', entries: [entry('f2', 'a.pdf', 10)], skipped: 0, truncated: false, partial: true },
  ]
  const text = renderPastasIndex(scans, new Date(2026, 10, 23, 18, 2), '/Users/x')
  const lines = text.split('\n')

  it('título, resumo com a data e a hora, a instrução de citação e uma seção por pasta com o caminho curto', () => {
    expect(lines[0]).toBe('# Pastas permitidas')
    expect(lines[1]).toBe('Atualizado em 2026-11-23 18:02. 2 pastas, 4 arquivos listados (lista incompleta).')
    expect(lines[2]).toBe('Cite um arquivo como [Pasta · <Pasta>/<caminho>](pasta:<id>). Para ler, use a ferramenta ler_arquivo_pasta com o id.')
    expect(lines.filter((line) => line.startsWith('## '))).toEqual(['## Documentos  (~/Documents/LAP/Documentos)  — 3 arquivos', '## Docs  (/Volumes/Disco/Docs)  — 1 arquivo'])
    expect(lines.filter((line) => line === '| id | arquivo | tipo | tamanho | modificado | legível |')).toHaveLength(2)
  })

  it('uma linha por arquivo, com o id, o caminho, a extensão, o tamanho, a data e se é legível', () => {
    const rows = lines.filter((line) => /^\| [0-9a-f]{16} \|/.test(line))
    expect(rows).toHaveLength(4)
    expect(rows).toContain(`| ${folderFileId('f1', 'Contratos/Contrato-ABF-2026.pdf')} | Contratos/Contrato-ABF-2026.pdf | pdf | 1,2 MB | 2026-10-02 | sim |`)
    expect(rows).toContain(`| ${folderFileId('f1', 'Apresentacoes/LAP.pptx')} | Apresentacoes/LAP.pptx | pptx | 240 KB | 2026-10-02 | não (só anexo) |`)
    // O nome com `|`, crase e quebra de linha fica numa linha, sem `|` e sem crase dentro da célula.
    const odd = rows.find((row) => row.startsWith(`| ${folderFileId('f1', 'Nome | com `crase`\ne quebra.pdf')} |`)) as string
    expect(odd.split(' | ')).toHaveLength(6)
    expect(odd).not.toContain('`')
    expect(odd).toContain('Nome com crase e quebra.pdf')
    for (const row of rows) expect(row.split('|')).toHaveLength(8)
  })

  it('as linhas de rodapé: não listados, de outros tipos e varredura interrompida; nunca conteúdo', () => {
    expect(text).toContain('… e outros arquivos não listados')
    expect(text).toContain('4 arquivos de outros tipos ou acima de 20 MB.')
    expect(text).toContain('varredura interrompida: lista parcial.')
    // Só a primeira pasta passou do limite; só a segunda parou no tempo.
    const second = text.slice(text.indexOf('## Docs'))
    expect(second).not.toContain('não listados')
    expect(text.slice(0, text.indexOf('## Docs'))).not.toContain('varredura interrompida')
  })

  it('sem nenhum arquivo, a seção diz isso; uma pasta só, no singular', () => {
    const empty = renderPastasIndex([{ folderId: 'f3', label: 'Vazia', path: '/Users/x/Vazia', entries: [], skipped: 0, truncated: false, partial: false }], new Date(2026, 10, 23, 9, 5), '/Users/x')
    expect(empty).toContain('Atualizado em 2026-11-23 09:05. 1 pasta, 0 arquivos listados.')
    expect(empty).toContain('## Vazia  (~/Vazia)  — 0 arquivos\nNenhum arquivo listado.')
    expect(empty).not.toContain('| id |')
  })
})
