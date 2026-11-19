// Sanitização do HTML do email (contrato 43, CA2): sem script, iframe, form, `on*`, `style` nem `javascript:`; imagem
// remota bloqueada até "Carregar imagens"; texto puro com os links à parte.
import { describe, expect, it } from 'vitest'
import { htmlToText, linkify, safeLinkUrl, sanitizeEmailHtml } from '../../src/renderer/src/features/email/sanitize'

describe('sanitizeEmailHtml', () => {
  it('tira script, style, iframe, form, objeto e svg com o conteúdo', () => {
    const { html } = sanitizeEmailHtml(
      '<p>Oi</p><script>alert(1)</script><style>p{color:red}</style><iframe src="https://x.example"></iframe><form action="https://x.example"><input name="a"><button>Ok</button></form><object data="x"></object><svg><script>alert(2)</script></svg><p>Fim</p>',
    )
    expect(html).toBe('<p>Oi</p><p>Fim</p>')
  })

  it('script sem fechamento leva o resto junto', () => {
    expect(sanitizeEmailHtml('<p>a</p><script>alert(1)').html).toBe('<p>a</p>')
  })

  it('tira os atributos de evento, o style e as cores; mantém o layout básico', () => {
    const { html } = sanitizeEmailHtml('<table width="600" bgcolor="red" onclick="x()"><tr><td colspan="2" style="color:red" align="center" onmouseover="y()">A</td></tr></table>')
    expect(html).toBe('<table width="600"><tr><td colspan="2" align="center">A</td></tr></table>')
  })

  it('links só http(s) e mailto; javascript: (mesmo disfarçado) sai', () => {
    expect(sanitizeEmailHtml('<a href="https://portal.example/p?a=1&amp;b=2" target="_blank">p</a>').html).toBe('<a href="https://portal.example/p?a=1&amp;b=2" data-email-link="">p</a>')
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>').html).toBe('<a>x</a>')
    expect(sanitizeEmailHtml('<a href="java&#115;cript:alert(1)">x</a>').html).toBe('<a>x</a>')
    expect(sanitizeEmailHtml('<a href=" JaVaScRiPt&colon;alert(1)">x</a>').html).toBe('<a>x</a>')
    expect(sanitizeEmailHtml('<a href="data:text/html,<script>">x</a>').html).toBe('<a>x</a>')
    expect(sanitizeEmailHtml('<a href="mailto:ana@cliente.example">ana</a>').html).toBe('<a href="mailto:ana@cliente.example" data-email-link="">ana</a>')
    expect(safeLinkUrl('vbscript:msgbox')).toBeNull()
  })

  it('imagem remota bloqueada por padrão (fica o texto alternativo) e carregada com a data URL do main', () => {
    const input = '<p>a</p><img src="https://cdn.example/logo.png" alt="Logo" width="120" onerror="x()"><img src="http://t.example/pixel.gif">'
    const blocked = sanitizeEmailHtml(input)
    expect(blocked.html).toBe('<p>a</p><span data-email-image-blocked>Logo</span><span data-email-image-blocked>Imagem</span>')
    expect(blocked.blocked).toEqual(['https://cdn.example/logo.png', 'http://t.example/pixel.gif'])
    const loaded = sanitizeEmailHtml(input, { images: { 'https://cdn.example/logo.png': 'data:image/png;base64,AAAA', 'http://t.example/pixel.gif': null } })
    expect(loaded.html).toBe('<p>a</p><img src="data:image/png;base64,AAAA" alt="Logo" width="120"><span data-email-image-blocked>Imagem</span>')
    expect(loaded.blocked).toEqual(['http://t.example/pixel.gif'])
  })

  it('imagem embutida só data:image de tipos comuns; cid e svg ficam de fora sem pedir nada', () => {
    expect(sanitizeEmailHtml('<img src="data:image/png;base64,AAAA">').html).toBe('<img src="data:image/png;base64,AAAA">')
    const svg = sanitizeEmailHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="s"><img src="cid:logo@x" alt="c">')
    expect(svg.html).toBe('<span data-email-image-blocked>s</span><span data-email-image-blocked>c</span>')
    expect(svg.blocked).toEqual([])
  })

  it('texto escapado; entidades e marcas desconhecidas não viram marca; tudo fechado no fim', () => {
    expect(sanitizeEmailHtml('a < b & c &amp; d &eacute; <b>forte').html).toBe('a &lt; b &amp; c &amp; d &eacute; <b>forte</b>')
    expect(sanitizeEmailHtml('<html><body><custom-x>dentro</custom-x></body></html>').html).toBe('dentro')
    expect(sanitizeEmailHtml('<font color="red">x</font><center>y</center>').html).toBe('<span>x</span><div>y</div>')
    expect(sanitizeEmailHtml('<div><p>um</div>').html).toBe('<div><p>um</p></div>')
    expect(sanitizeEmailHtml('&lt;script&gt;alert(1)&lt;/script&gt;').html).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('comentário, doctype e atributo com aspas trocadas não abrem nada', () => {
    expect(sanitizeEmailHtml('<!DOCTYPE html><!-- <script>x</script> --><p title="a>b">ok</p>').html).toBe('<p title="a&gt;b">ok</p>')
    expect(sanitizeEmailHtml('<p title=\'"><script>x</script>\'>ok</p>').html).toBe('<p title="&quot;&gt;&lt;script&gt;x&lt;/script&gt;">ok</p>')
  })
})

describe('nomes que existem no protótipo (revisão do contrato 43)', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])('%s como atributo, como marca e como imagem pedida não quebra nem passa', (name) => {
    expect(sanitizeEmailHtml(`<p ${name}="x" title="t">a</p>`).html).toBe('<p title="t">a</p>')
    // Nome que não começa por letra nem é marca: fica como texto escapado; o resto sai.
    const tag = sanitizeEmailHtml(`<${name}>b</${name}><img src="https://x.example/${name}">`, { images: {} }).html
    expect(tag.endsWith('<span data-email-image-blocked>Imagem</span>')).toBe(true)
    expect(tag).not.toContain(`<${name}`)
    expect(sanitizeEmailHtml(`<img src="${name}">`, { images: {} }).html).toBe('<span data-email-image-blocked>Imagem</span>')
    expect(htmlToText(`&${name};x`)).toBe(`&${name};x`)
  })
})

describe('htmlToText e linkify', () => {
  it('HTML vira texto em linhas, sem o que fica escondido', () => {
    expect(htmlToText('<style>p{}</style><p>Ol&aacute;,</p><p>Segue a <b>proposta</b>.<br>Abraço</p>')).toBe('Olá,\nSegue a proposta.\nAbraço')
  })

  it('links http(s) à parte, sem a pontuação do fim', () => {
    expect(linkify('Veja https://portal.example/p. E (http://x.example/a_(b)) ok')).toEqual([
      { kind: 'text', text: 'Veja ' },
      { kind: 'link', text: 'https://portal.example/p', url: 'https://portal.example/p' },
      { kind: 'text', text: '. E (' },
      { kind: 'link', text: 'http://x.example/a_(b)', url: 'http://x.example/a_(b)' },
      { kind: 'text', text: ') ok' },
    ])
    expect(linkify('sem link')).toEqual([{ kind: 'text', text: 'sem link' }])
  })
})
