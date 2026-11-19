// Ferramentas do próprio app para o Assistente (contrato 45, CA7), sem MCP: o Claude pede uma ferramenta terminando a
// resposta com um bloco cercado `lap-ferramenta` com um JSON (`{"ferramenta": "<nome>", ...}`); o main valida, roda a
// ferramenta (só leitura), grava o resultado num arquivo da pasta da conversa e manda, na mesma sessão, uma mensagem
// curta dizendo onde ele está. O Claude lê o arquivo com as ferramentas de leitura de sempre e responde. Até
// `TOOL_ROUNDS_MAX` rodadas por pergunta; depois disso, ou com um bloco inválido, a resposta fica como veio.
//
// Cada conjunto de ferramentas é dado por quem monta a conversa: hoje só o Assistente interativo recebe as do email
// (buscar e ler, só leitura). As execuções agendadas não recebem nenhuma. Uma ferramenta que mude algo (o envio
// pré-autorizado de uma tarefa, contrato futuro) entraria como outra entrada deste registro, dada só onde valer.
import { z } from 'zod'
import { TOOL_FENCE } from '../../shared/assistant'

export { TOOL_FENCE } from '../../shared/assistant'
/** Rodadas de ferramenta numa pergunta; a 5ª fica como texto. */
export const TOOL_ROUNDS_MAX = 4

/** O que a ferramenta devolve: o arquivo gravado na pasta e uma linha para o passo da tela. */
export interface ToolResult {
  file: string | null
  /** "Buscando emails: de Marina (12 achados)". Sem conteúdo de mensagem. */
  label: string
  /** O que vai na mensagem de volta, quando não há arquivo ("O app está bloqueado."). */
  note?: string | undefined
}

export interface AssistantTool {
  name: string
  /** Como a instrução do sistema descreve a ferramenta e os campos. */
  describe: string
  /** O passo da tela antes de rodar ("Buscando emails"), com o ícone da busca (`Grep`) ou da leitura (`Read`). */
  pending: string
  step: 'Grep' | 'Read'
  run(args: Record<string, unknown>, folder: string): Promise<ToolResult>
}

/** O bloco ```lap-ferramenta … ``` numa linha própria. */
const FENCE_PATTERN = new RegExp(`(^|\\n)[ \\t]*\`\`\`${TOOL_FENCE}[ \\t]*\\n([\\s\\S]*?)\\n[ \\t]*\`\`\`[ \\t]*(?=\\n|$)`)

const callSchema = z.object({ ferramenta: z.string().regex(/^[a-z_]{1,40}$/) }).passthrough()

/** O primeiro pedido de ferramenta válido da resposta (de uma ferramenta que existe aqui), ou `null`. */
export function toolCallOf(text: string, tools: readonly AssistantTool[]): { tool: AssistantTool; args: Record<string, unknown>; before: string } | null {
  const match = FENCE_PATTERN.exec(text)
  if (!match) return null
  let json: unknown
  try {
    json = JSON.parse(match[2] ?? '')
  } catch {
    return null
  }
  const parsed = callSchema.safeParse(json)
  if (!parsed.success) return null
  const tool = tools.find((candidate) => candidate.name === parsed.data.ferramenta)
  if (!tool) return null
  const { ferramenta: _name, ...args } = parsed.data
  return { tool, args, before: text.slice(0, match.index).trim() }
}

/** O texto sem os pedidos de ferramenta (a resposta que estourou as rodadas não guarda o bloco). */
export function withoutToolCalls(text: string): string {
  return text.replace(new RegExp(FENCE_PATTERN.source, 'g'), '$1').replace(/\n{3,}/g, '\n\n').trim()
}

/** A mensagem de volta, na mesma sessão: onde está o resultado, e que a pergunta é a mesma. */
export function toolFollowUp(name: string, result: ToolResult): string {
  const where = result.file ? `O resultado está no arquivo ${result.file}, na pasta atual: abra e use.` : (result.note ?? 'A ferramenta não devolveu nada.')
  return `[Resultado da ferramenta ${name}] ${where} Continue respondendo à mesma pergunta da pessoa; peça outra ferramenta só se precisar.`
}

/** As regras e as ferramentas, para a instrução do sistema. */
export function toolsInstructions(tools: readonly AssistantTool[]): string[] {
  if (!tools.length) return []
  const fence = '```'
  return [
    `Você também tem ferramentas do próprio app, só de leitura. Para usar uma, termine a resposta com um único bloco, exatamente neste formato, e nada depois dele: ${fence}${TOOL_FENCE} na primeira linha, o JSON {"ferramenta": "<nome>", ...campos} na segunda e ${fence} na terceira. O app roda a ferramenta, grava o resultado num arquivo da pasta e devolve o nome dele; aí você lê o arquivo e responde. Até ${TOOL_ROUNDS_MAX} ferramentas por pergunta. Use só quando os arquivos da pasta não bastarem.`,
    ...tools.map((tool) => `- ${tool.name}: ${tool.describe}`),
  ]
}
