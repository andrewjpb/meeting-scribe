import { Check, FileText, TriangleAlert, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FunilImportAbrirResult } from '@shared/funil'
import { IMPORT_PREVIA_LINHAS, type CampoImport } from '@shared/funil-import'
import { Button } from '../../design/Button'
import { Select } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { CANCELAR_CLASS } from './KanbanCard'
import { textoArquivoImport, textoResultadoImport } from './funilFormat'
import { useFunil } from './funilStore'

export type ImportAberto = Extract<FunilImportAbrirResult, { ok: true }>

/** As opções de cada coluna (R14), na ordem do artboard 07. */
const CAMPOS: readonly { value: CampoImport; label: string }[] = [
  { value: 'nome', label: 'Nome' },
  { value: 'email', label: 'E-mail' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'empresa', label: 'Empresa' },
  { value: 'cargo', label: 'Cargo' },
  { value: 'ignorar', label: 'Ignorar' },
]

/** O texto de cada falha ao abrir o arquivo (R13 a R15); `cancelado` não muda a tela. */
export const IMPORT_ERRO_TEXTO: Record<Exclude<Extract<FunilImportAbrirResult, { ok: false }>['erro'], 'cancelado'>, string> = {
  'arquivo-grande': 'O arquivo passa de 5 MB.',
  'linhas-demais': 'O arquivo tem mais de 10 000 linhas.',
  formato: 'Não reconheci esse arquivo como CSV ou vCard.',
  falhou: 'Não foi possível ler o arquivo. Tente de novo.',
}

type Resultado = { criados: number; atualizados: number; ignorados: number }

/**
 * Importar contatos (contrato 114, R13 a R16, artboard 07), no lugar da ficha: o arquivo, a prévia das 5 primeiras linhas
 * com um `Select` por coluna (no vCard, sem Selects), o botão com o número de linhas que entram (recontado pelo main a
 * cada troca de coluna, sem gravar) e, depois do clique, a linha do resultado. A leitura que expirou no main pede outro
 * arquivo.
 */
export function ImportarPainel({ arquivo, onTrocar, onFechar }: { arquivo: ImportAberto; onTrocar: () => void; onFechar: () => void }) {
  const [mapeamento, setMapeamento] = useState<CampoImport[]>(arquivo.mapeamento)
  const [validas, setValidas] = useState(arquivo.validas)
  const [erro, setErro] = useState<string | null>(null)
  const [expirado, setExpirado] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  /** Cada troca de coluna recebe um número: só a resposta da mais recente muda o botão (as do main podem chegar fora de ordem). */
  const contagemAtual = useRef(0)
  const csv = arquivo.tipo === 'csv'
  const ignoradas = Math.max(0, arquivo.total - validas)

  const trocarColuna = async (index: number, campo: CampoImport): Promise<void> => {
    const proximo = mapeamento.map((atual, i) => (i === index ? campo : atual))
    setMapeamento(proximo)
    setErro(null)
    const pedido = ++contagemAtual.current
    const contagem = await useFunil.getState().importarConfirmar({ token: arquivo.token, mapeamento: proximo, simular: true })
    if (pedido !== contagemAtual.current) return
    if (contagem.ok && contagem.simulado) setValidas(contagem.validas)
    else if (!contagem.ok) {
      setExpirado(contagem.erro === 'expirado')
      setErro(contagem.mensagem)
    }
  }

  const importar = async (): Promise<void> => {
    if (ocupado || validas === 0) return
    setOcupado(true)
    setErro(null)
    const result = await useFunil.getState().importarConfirmar({ token: arquivo.token, ...(csv ? { mapeamento } : {}) })
    setOcupado(false)
    if (result.ok && !result.simulado) setResultado({ criados: result.criados, atualizados: result.atualizados, ignorados: result.ignorados })
    else if (!result.ok) {
      setExpirado(result.erro === 'expirado')
      setErro(result.mensagem)
    }
  }

  const resumo = resultado ? textoResultadoImport(resultado) : ''
  const corte = resumo.indexOf(' (')

  return (
    <div data-funil-importar={arquivo.tipo} className="flex max-w-[760px] flex-col">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-15 font-bold tracking-[-0.2px] text-title">Importar contatos</h2>
        <button type="button" data-action="funil-importar-cancelar" onClick={onFechar} className={CANCELAR_CLASS}>
          {resultado ? 'Fechar' : 'Cancelar'}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Icon icon={FileText} className="shrink-0 text-text-muted" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p data-funil-import-arquivo className="truncate text-13 font-semibold text-title">
            {arquivo.arquivo}
          </p>
          <p data-funil-import-info className="truncate text-12 text-text-muted tabular">
            {textoArquivoImport(arquivo)}
          </p>
        </div>
        {!resultado && (
          <Button variant="secondary" action="funil-importar-trocar" onClick={onTrocar}>
            Trocar arquivo…
          </Button>
        )}
      </div>
      <p className="mt-3 text-12 font-medium text-text-muted">
        {csv
          ? `${arquivo.previa.length < IMPORT_PREVIA_LINHAS ? `Prévia das ${arquivo.previa.length} linhas.` : `Prévia das ${IMPORT_PREVIA_LINHAS} primeiras linhas.`} Confira o que cada coluna é.`
          : arquivo.previa.length < IMPORT_PREVIA_LINHAS
            ? `Prévia dos ${arquivo.previa.length} cartões.`
            : `Prévia dos ${IMPORT_PREVIA_LINHAS} primeiros cartões.`}
      </p>
      <div className="mt-2 overflow-x-auto rounded-[var(--radius-panel)] border border-line-strong">
        <table data-funil-import-previa className="w-full min-w-[480px] table-fixed border-collapse text-13">
          <thead>
            <tr className="bg-bg-sunken">
              {arquivo.colunas.map((coluna, index) => (
                <th key={index} scope="col" className="px-2 pt-2 pb-1 text-left text-12 font-medium text-text-muted">
                  <span className="block truncate" title={coluna}>
                    {coluna || `Coluna ${index + 1}`}
                  </span>
                </th>
              ))}
            </tr>
            {csv && (
              <tr className="bg-bg-sunken">
                {arquivo.colunas.map((coluna, index) => (
                  <td key={index} data-funil-import-coluna={index} className="px-1.5 pb-2 [&>select]:w-full [&>select]:min-w-0">
                    <label htmlFor={`funil-import-coluna-${index}`} className="sr-only">
                      {`O que é a coluna ${coluna || index + 1}`}
                    </label>
                    <Select id={`funil-import-coluna-${index}`} value={mapeamento[index] ?? 'ignorar'} options={CAMPOS} onChange={(campo) => void trocarColuna(index, campo)} />
                  </td>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {arquivo.previa.map((linha, row) => (
              <tr key={row} data-funil-import-linha={row} className="border-t border-line">
                {arquivo.colunas.map((_, index) => {
                  const valor = (linha[index] ?? '').trim()
                  const ignorada = csv && mapeamento[index] === 'ignorar'
                  return (
                    <td key={index} className={`h-8 px-2 ${ignorada ? 'text-text-faint' : 'text-text'}`}>
                      <span className="block truncate" title={valor || undefined}>
                        {valor || '—'}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {erro && (
        <Note
          id="funil-import-erro"
          icon={TriangleAlert}
          role="alert"
          className="mt-3"
          action={
            expirado ? (
              <button type="button" data-action="funil-importar-reabrir" className={`${NOTE_ACTION_CLASS} text-13`} onClick={onTrocar}>
                Trocar arquivo…
              </button>
            ) : undefined
          }
        >
          {erro}
        </Note>
      )}
      {resultado ? (
        <div data-funil-import-resultado className="mt-3">
          <Note id="funil-import-resultado" icon={Check} role="status">
            <span className="font-semibold text-title tabular">{corte < 0 ? resumo : resumo.slice(0, corte)}</span>
            {corte < 0 ? '' : <span className="text-text-muted">{resumo.slice(corte)}</span>}
          </Note>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button icon={Upload} action="funil-importar-confirmar" disabled={ocupado || expirado || validas === 0} onClick={() => void importar()}>
            {`Importar ${validas} ${validas === 1 ? 'contato' : 'contatos'}`}
          </Button>
          <p data-funil-import-dica className="min-w-0 flex-[1_1_280px] text-12 text-pretty text-text-muted">
            {ignoradas > 0 ? `${ignoradas} ${ignoradas === 1 ? 'linha sem e-mail nem telefone fica de fora.' : 'linhas sem e-mail nem telefone ficam de fora.'} ` : ''}
            E-mail ou telefone repetido completa o contato que já existe.
          </p>
        </div>
      )}
    </div>
  )
}
