// Contrato 157 (CA12): os arquivos novos do Painel de e-mail só usam os tokens (nenhuma cor literal nem cor fora da
// paleta do Tailwind de tokens), sem sombra, sem pílula, sem raio acima de 6 px e sem modal (`fixed`, portal). Os gates 6 e
// 7 conferem o renderer inteiro; aqui, os arquivos do contrato, com o motivo de cada falha. Também nada de console.
import { describe, expect, it } from 'vitest'
// O texto dos arquivos (`?raw`, como o teste da barra lateral lê a tabela de rotas).
import painel from '../../src/renderer/src/features/email/PainelEmail.tsx?raw'
import painelFormat from '../../src/renderer/src/features/email/painelFormat.ts?raw'
import painelStore from '../../src/renderer/src/features/email/painelStore.ts?raw'
import secao from '../../src/renderer/src/features/settings/EmailPainelSection.tsx?raw'

const ARQUIVOS: Readonly<Record<string, string>> = { 'PainelEmail.tsx': painel, 'painelStore.ts': painelStore, 'painelFormat.ts': painelFormat, 'EmailPainelSection.tsx': secao }

const PROIBIDOS: readonly [RegExp, string][] = [
  [/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'cor literal'],
  [/(^|[\s"'`:])(shadow|ring|inset-shadow|inset-ring)(-[^\s"'`]+)?(?=[\s"'`]|$)/, 'sombra'],
  [/boxShadow/, 'sombra em linha'],
  [/rounded-full|rounded(-[a-z]{1,2})?-(lg|xl|[2-9]xl)\b|rounded(-[a-z]{1,2})?-\[([7-9]|[1-9]\d+)px\]/, 'pílula ou raio acima de 6 px'],
  [/(^|[\s"'`])fixed(?=[\s"'`])|createPortal|role="dialog"|role="alertdialog"/, 'modal'],
  [/\b(text|bg|border|fill|stroke)-(red|blue|green|gray|slate|zinc|neutral|white|black|yellow|orange|sky|indigo)(-\d+)?\b/, 'cor fora dos tokens'],
  [/\bconsole\.[a-z]+\(/, 'console'],
]

describe('Painel de e-mail só com os tokens do design (CA12)', () => {
  for (const [arquivo, texto] of Object.entries(ARQUIVOS)) {
    it(arquivo, () => {
      expect(texto.length).toBeGreaterThan(0)
      const achados = PROIBIDOS.flatMap(([padrao, motivo]) => (padrao.test(texto) ? [motivo] : []))
      expect(achados).toEqual([])
    })
  }
})
