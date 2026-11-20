// Primeira passada da densidade (contrato 83) nos artboards de docs/telas/artboards: troca os valores literais da
// escala antiga pelos da densa (docs/specs/_archive/densidade/spec.md) nos estilos em linha. É só a passada mecânica:
// cada artboard foi revisado à mão depois, renderizado e comparado ao print do smoke. O que o script não distingue foi
// acertado à mão: o título do estado vazio (17), os botões dos segmentados (28 de altura e 12 de padding, em
// ConfigGeral e ConfigClaude, que tinham 38), o quadro do logo em ConfigGeral (40, como no app) e o rodapé da barra.
// Cada arquivo tratado ganha a marca `densidade: adensar.mjs` e é pulado numa segunda rodada (as trocas não são
// idempotentes: 26→20 e depois 20→15 daria 15). Uso: node docs/telas/scripts/adensar.mjs [arquivo.dc.html ...]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ARTBOARDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'artboards')
const MARK = '<!-- densidade: adensar.mjs -->'

/** Caixa alta que fica: rótulos de fonte de áudio (fita, transcrição) e a marca. */
const KEEP_CAPS = /^(VOCÊ|PARTICIPANTES?( [A-Z])?|LAP SOFTWARE)$/

/** Uma troca só por estilo (as regras de título rodam juntas, para 26→20 não virar 15 em seguida). */
function densify(style) {
  let s = style
  // Controles (botão, campo, aba, item da raiz da barra): 40 → 32. Quadrado de ícone de 40 também.
  s = s.replace(/(^|[;\s])(min-height|height|width): 40px/g, '$1$2: 32px').replace(/flex: 0 0 40px/g, 'flex: 0 0 32px')
  // Linhas de nível da barra: 30 → 28.
  s = s.replace(/(^|[;\s])height: 30px/g, '$1height: 28px')
  // Linhas de configuração e de lista: 64 e 56 → 44.
  s = s.replace(/min-height: (64|56)px/g, 'min-height: 44px')
  // Cabeçalhos de painel (conversa, leitura, WhatsApp, detalhes): 56 e 48 → 44.
  s = s.replace(/flex: 0 0 (56|48)px; height: (56|48)px/g, 'flex: 0 0 44px; height: 44px')
  // Títulos: página 26/32 → 20/26; painel 20/26 → 15/20; bloco 17/24 → 14/20. Transcrição 16/26 → 15/24.
  const TITLES = { '26px; line-height: 32px': '20px; line-height: 26px', '20px; line-height: 26px': '15px; line-height: 20px', '17px; line-height: 24px': '14px; line-height: 20px', '16px; line-height: 26px': '15px; line-height: 24px' }
  s = s.replace(/font-size: (26px; line-height: 32px|20px; line-height: 26px|17px; line-height: 24px|16px; line-height: 26px)/, (_, key) => `font-size: ${TITLES[key]}`)
  // Balões e prévias: 15/22 → 14/22.
  s = s.replace(/font-size: 15px; line-height: 22px/g, 'font-size: 14px; line-height: 22px')
  // Respiro da página: 40 nas laterais → 32; 28 no topo → 20 (inclusive o rótulo da fita, a 40 da borda).
  s = s.replace(/padding: (\d+(?:px)?) 40px( \d+px)?/g, (_, top, bottom = '') => `padding: ${top === '28px' || top === '32px' || top === '24px' ? '20px' : top} 32px${bottom === ' 48px' || bottom === ' 40px' ? ' 32px' : bottom}`)
  s = s.replace(/(^|[;\s])left: 40px/g, '$1left: 32px')
  s = s.replace(/padding-top: 28px/g, 'padding-top: 20px')
  return s
}

/** Rótulo de seção em caixa alta (10 px espaçado ou `text-transform: uppercase`) → 11/16, peso 500, caixa normal. */
function toLabel(style) {
  return style
    .replace(/font-size: \d+px; line-height: \d+px/, 'font-size: 11px; line-height: 16px')
    .replace(/font-weight: \d+/, 'font-weight: 500')
    .replace(/;?\s*letter-spacing: 0\.\d+em/g, '')
    .replace(/;?\s*text-transform: uppercase/g, '')
}

const sentence = (text) => text.charAt(0) + text.slice(1).toLocaleLowerCase('pt-BR')

export function adensar(html) {
  if (html.includes(MARK)) return html
  let out = html.replace(/style="([^"]*)"([^>]*>)([^<]*)/g, (whole, style, rest, text) => {
    const caps = /letter-spacing: 0\.1\d?em/.test(style) || /text-transform: uppercase/.test(style)
    const keep = KEEP_CAPS.test(text.trim()) || /position: absolute/.test(style)
    if (caps && !keep) {
      const label = text.trim() && text === text.toLocaleUpperCase('pt-BR') && /\p{Lu}{2}/u.test(text) ? sentence(text) : text
      return `style="${toLabel(densify(style))}"${rest}${label}`
    }
    return `style="${densify(style)}"${rest}${text}`
  })
  out = out.replace('<!doctype html>', `<!doctype html>\n${MARK}`)
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(ARTBOARDS).filter((f) => f.endsWith('.dc.html') && !f.startsWith('Print')).map((f) => join(ARTBOARDS, f))
  for (const file of files) {
    const before = readFileSync(file, 'utf8')
    const after = adensar(before)
    if (after !== before) writeFileSync(file, after)
    console.log(`${after === before ? 'igual' : 'adensado'}  ${basename(file)}`)
  }
}
