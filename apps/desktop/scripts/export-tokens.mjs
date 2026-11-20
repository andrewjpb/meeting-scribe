// Exporta os tokens do app para os artefatos de design (contrato 83): lê design/tokens.css (os dois temas e os valores
// comuns) e a escala de texto e as alturas da barra lateral de design/base.css, e grava
// docs/telas/ds/lap-reunioes/tokens.json. A fonte da verdade continua sendo o CSS: o JSON é só a cópia legível pelo
// design system e pelos artboards. Determinístico (sem data, na ordem do CSS): rodar de novo sem mudar o CSS não muda
// o arquivo. Uso: `pnpm tokens:export` na raiz; com um caminho como argumento, grava nele (o teste usa).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = join(appDir, '..', '..')
const designDir = join(appDir, 'src', 'renderer', 'src', 'design')
const TOKENS_CSS = join(designDir, 'tokens.css')
const BASE_CSS = join(designDir, 'base.css')
const TOKENS_JSON = join(repoDir, 'docs', 'telas', 'ds', 'lap-reunioes', 'tokens.json')

/** Corpo do primeiro bloco `{ … }` depois do seletor (os blocos de tokens.css não têm chaves aninhadas). */
function block(css, selector) {
  const match = selector.exec(css)
  if (!match) throw new Error(`bloco ${selector} não encontrado`)
  const start = match.index + match[0].length
  return css.slice(start, css.indexOf('}', start))
}

/** Variáveis `--nome: valor;` de um trecho de CSS, sem comentários, na ordem em que aparecem. */
function variables(css) {
  const vars = new Map()
  for (const [, name, value] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(name, value.trim().replace(/\s+/g, ' '))
  }
  return vars
}

const pick = (vars, test) => Object.fromEntries([...vars].filter(([name]) => test(name)))

const DENSITY = ['control-h', 'control-compact-h', 'row-h', 'row-compact-h', 'panel-head-h', 'page-x', 'page-top']
const SIDEBAR = ['side-row', 'side-subrow', 'side-indent']
const WIDTHS = ['sidebar-width', 'titlebar-height', 'settings-width', 'settings-control-width']

function buildTokens(tokensCss, baseCss) {
  const light = variables(block(tokensCss, /:root,\s*\[data-theme='light'\]\s*\{/))
  const dark = variables(block(tokensCss, /\[data-theme='dark'\]\s*\{/))
  // O terceiro bloco: `:root {` sozinho no começo da linha (o primeiro é `:root,`).
  const common = variables(block(tokensCss, /^:root\s*\{/m))
  const theme = block(baseCss, /@theme inline\s*\{/)
  // As alturas da barra lateral (contrato 79) moram em base.css, fora do @theme.
  const sidebar = variables(baseCss)

  const text = {}
  for (const [, size, px, lh] of theme.matchAll(/--text-(\d+):\s*(\d+px);\s*--text-\1--line-height:\s*(\d+px);/g)) {
    text[size] = { 'font-size': px, 'line-height': lh }
  }

  // Os dois estilos de rótulo: `.label` (rótulo de seção, caixa normal) e `.caps` (só fita e marca).
  const styles = {}
  for (const name of ['label', 'caps']) {
    const body = block(baseCss, new RegExp(`\\.${name}\\s*\\{`))
    styles[name] = Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, prop, value]) => [prop, value.trim()]))
  }

  const isColor = (value) => /^(#|rgba?\(|transparent$)/.test(value)
  const omitScheme = (vars) => pick(vars, (name) => name !== 'color-scheme')
  return {
    $fonte: 'Gerado por apps/desktop/scripts/export-tokens.mjs a partir de design/tokens.css e design/base.css. Não edite à mão: rode `pnpm tokens:export`.',
    cores: {
      claro: omitScheme(light),
      escuro: omitScheme(dark),
      comuns: pick(common, (name) => isColor(common.get(name))),
    },
    fontes: pick(common, (name) => name.startsWith('font-')),
    espacos: pick(common, (name) => name.startsWith('space-')),
    raios: pick(common, (name) => name.startsWith('radius-')),
    densidade: pick(common, (name) => DENSITY.includes(name)),
    barraLateral: pick(sidebar, (name) => SIDEBAR.includes(name)),
    larguras: pick(common, (name) => WIDTHS.includes(name)),
    movimento: pick(common, (name) => name.startsWith('duration-') || name.startsWith('ease-')),
    texto: text,
    estilos: styles,
  }
}

const out = process.argv[2] ? resolve(process.argv[2]) : TOKENS_JSON
const tokens = buildTokens(readFileSync(TOKENS_CSS, 'utf8'), readFileSync(BASE_CSS, 'utf8'))
writeFileSync(out, `${JSON.stringify(tokens, null, 2)}\n`)
console.log(`tokens gravados em ${relative(repoDir, out)}`)
