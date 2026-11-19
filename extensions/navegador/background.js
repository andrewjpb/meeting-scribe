// LAP Reuniões — Controle do navegador (contrato 46, plugin-navegador): pede ao app, por long-poll em
// http://127.0.0.1:<porta>/v1/navegador/comandos, o próximo comando; executa numa janela do Chrome que esta
// extensão mesma abriu e devolve o resultado por POST em /v1/navegador/resultados. Só fala com 127.0.0.1: nada
// sai do computador. Nunca toca uma aba da pessoa: tudo acontece na janela própria (`janela`), que pode ter várias
// abas, cada uma com um número sequencial (`aba`: 1, 2, 3…) que não muda até ela fechar. O texto das páginas é
// dado que volta ao app, nunca comando: esta extensão só executa o que chega do app, um por vez.
//
// O Chrome para o service worker quando quer: a janela, o mapa das abas, o último número dado e a aba usada por último
// ficam também em `chrome.storage.session` (só na memória do Chrome, apagado ao fechar o navegador) e voltam na subida,
// conferidos: a janela que não existe mais é esquecida, e a aba fechada ou levada para outra janela sai do mapa.
'use strict'

/** Portas que o app pode usar, na ordem em que ele tenta. */
const PORTS = [47672, 47673, 47674, 47675, 47676, 47677, 47678, 47679, 47680, 47681]
const COMANDOS_PATH = '/v1/navegador/comandos'
const RESULTADOS_PATH = '/v1/navegador/resultados'
/** O app segura o GET até 25 s; passou disto, a porta não é o app. */
const POLL_TIMEOUT_MS = 30_000
const POST_TIMEOUT_MS = 5_000
/** App fechado: espera isto antes de procurar de novo nas 10 portas. */
const RETRY_MS = 5_000
/** Limites do app: o texto visível de `ler` e os elementos interativos. */
const TEXTO_MAX = 40 * 1024
const ELEMENTOS_MAX = 500
const ROTULO_MAX = 200
const ERRO_MAX = 300
/** Abas abertas ao mesmo tempo na janela própria. */
const ABAS_MAX = 10
/** O app recusa corpo acima de 512 KB; o resultado sai com folga abaixo disso. */
const CORPO_MAX_BYTES = 480 * 1024
/** Página que não termina de carregar: segue depois disto com o que tiver. */
const CARREGAR_MS = 15_000
/** Depois do clique, espera isto para ver se a página começou a navegar. */
const DEPOIS_DO_CLIQUE_MS = 500

const REF_VENCIDA = 'ref vencida, leia a página de novo'
const JANELA_FECHADA = 'janela fechada'
const ABA_NAO_EXISTE = 'aba não existe'

/** Porta que respondeu por último (`null`: procura de novo na ordem). */
let port = null
let rodando = false
/** A janela que esta extensão abriu no primeiro `abrir`: `{ windowId }`, ou `null`. */
let janela = null
/** Número da aba → `tabId`, só das abas da janela própria. */
const abas = new Map()
/** Último número dado; nunca é reaproveitado. */
let ultimaAba = 0
/** A aba usada por último: vale quando o comando não diz qual. */
let ativa = null

/** Chave do estado em `chrome.storage.session`. */
const ESTADO_KEY = 'navegador-estado'

class ErroComando extends Error {}

/** Grava o estado de agora (falha de gravação não para o comando: só perde a lembrança). */
function salvar() {
  const estado = { janela, abas: [...abas], ultimaAba, ativa }
  void chrome.storage.session.set({ [ESTADO_KEY]: estado }).catch(() => undefined)
}

/** Na subida do service worker: o estado gravado, só com a janela e as abas que ainda existem. */
async function restaurar() {
  const gravado = await chrome.storage.session.get(ESTADO_KEY).catch(() => ({}))
  const estado = gravado && gravado[ESTADO_KEY]
  if (!estado || typeof estado !== 'object') return
  if (Number.isInteger(estado.ultimaAba) && estado.ultimaAba > ultimaAba) ultimaAba = estado.ultimaAba
  const windowId = estado.janela && Number.isInteger(estado.janela.windowId) ? estado.janela.windowId : null
  const existe = windowId === null ? null : await chrome.windows.get(windowId).catch(() => null)
  if (!existe) {
    salvar()
    return
  }
  janela = { windowId }
  for (const par of Array.isArray(estado.abas) ? estado.abas : []) {
    if (!Array.isArray(par) || !Number.isInteger(par[0]) || !Number.isInteger(par[1]) || abas.size >= ABAS_MAX) continue
    const tab = await chrome.tabs.get(par[1]).catch(() => null)
    if (tab && tab.windowId === windowId) abas.set(par[0], par[1])
  }
  ativa = Number.isInteger(estado.ativa) && abas.has(estado.ativa) ? estado.ativa : abas.size ? Math.max(...abas.keys()) : null
  salvar()
}

/** O estado restaurado: todo comando e todo evento das abas esperam por ele. */
const pronto = restaurar().catch(() => undefined)

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isHttpUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function esquecerJanela() {
  janela = null
  abas.clear()
  ativa = null
  salvar()
}

const numeroDa = (tabId) => {
  for (const [aba, id] of abas) if (id === tabId) return aba
  return null
}

/** Tira a aba do mapa; se era a usada por último, passa a valer a mais nova que sobrou. */
function esquecerAba(aba) {
  abas.delete(aba)
  if (ativa === aba) ativa = abas.size ? Math.max(...abas.keys()) : null
  salvar()
}

function adotar(tabId) {
  ultimaAba += 1
  abas.set(ultimaAba, tabId)
  salvar()
  return ultimaAba
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  await pronto
  if (janela && janela.windowId === windowId) esquecerJanela()
})
// Fechada à mão pela pessoa (ou pela página): sai do mapa.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await pronto
  const aba = numeroDa(tabId)
  if (aba !== null) esquecerAba(aba)
})
// Link `_blank` de uma aba nossa, aberto dentro da janela própria: entra no mapa com o próximo número. Aba de outra
// janela, ou sem uma aba nossa como origem, nunca entra.
chrome.tabs.onCreated.addListener(async (tab) => {
  await pronto
  if (!janela || tab.id === undefined || tab.windowId !== janela.windowId) return
  if (tab.openerTabId === undefined || numeroDa(tab.openerTabId) === null || numeroDa(tab.id) !== null) return
  if (abas.size >= ABAS_MAX) return
  adotar(tab.id)
})

/** A aba pedida (ou a usada por último) da janela própria, ainda aberta: `{ aba, tab }`. */
async function abaPropria(numero) {
  if (!janela) throw new ErroComando(JANELA_FECHADA)
  const aba = numero === undefined ? ativa : numero
  const tabId = aba === null ? undefined : abas.get(aba)
  if (tabId === undefined) throw new ErroComando(ABA_NAO_EXISTE)
  const tab = await chrome.tabs.get(tabId).catch(() => null)
  if (!tab || tab.windowId !== janela.windowId) {
    esquecerAba(aba)
    throw new ErroComando(ABA_NAO_EXISTE)
  }
  ativa = aba
  return { aba, tab }
}

/** Espera a aba terminar de carregar (no máximo `ms`). */
function esperarCarregar(tabId, ms = CARREGAR_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(fim, ms)
    function fim() {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(ouvir)
      resolve()
    }
    function ouvir(id, info) {
      if (id === tabId && info.status === 'complete') fim()
    }
    chrome.tabs.onUpdated.addListener(ouvir)
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') fim()
      },
      () => fim(),
    )
  })
}

const pagina = (tab) => ({ titulo: tab.title || '', url: tab.url || '' })

/** Sempre uma aba nova na janela própria; a primeira chamada cria a janela. */
async function abrir(url) {
  if (!isHttpUrl(url)) throw new ErroComando('endereço recusado: só http ou https')
  const existe = janela ? await chrome.windows.get(janela.windowId).catch(() => null) : null
  if (!existe) esquecerJanela()
  if (abas.size >= ABAS_MAX) throw new ErroComando(`muitas abas: feche alguma antes (máximo ${ABAS_MAX})`)
  let tabId
  if (existe) {
    // Ativa dentro da janela própria, que segue sem foco: a janela da pessoa continua na frente.
    const tab = await chrome.tabs.create({ windowId: janela.windowId, url, active: true })
    tabId = tab.id
  } else {
    // Janela nova, sem foco: não rouba o teclado da pessoa.
    const criada = await chrome.windows.create({ url, focused: false, type: 'normal' })
    const tab = criada.tabs && criada.tabs[0]
    if (!tab || tab.id === undefined) throw new ErroComando('não abriu a janela')
    janela = { windowId: criada.id }
    tabId = tab.id
  }
  if (tabId === undefined) throw new ErroComando('não abriu a aba')
  // Se o Chrome der `openerTabId` à aba criada, o `onCreated` já a adotou: não entra duas vezes no mapa.
  const aba = numeroDa(tabId) ?? adotar(tabId)
  ativa = aba
  await esperarCarregar(tabId)
  const { tab } = await abaPropria(aba)
  return { aba, ...pagina(tab) }
}

async function listarAbas() {
  if (!janela) throw new ErroComando(JANELA_FECHADA)
  const lista = []
  for (const [aba, tabId] of [...abas].sort((a, b) => a[0] - b[0])) {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    // Fechada, ou arrastada pela pessoa para outra janela: deixa de ser nossa.
    if (!tab || tab.windowId !== janela.windowId) {
      esquecerAba(aba)
      continue
    }
    lista.push({ aba, ...pagina(tab), ativa: aba === ativa })
  }
  return { abas: lista }
}

/**
 * Roda dentro da página (injetada a cada `ler`): título, texto visível cortado e os elementos interativos
 * visíveis, cada um com um `ref` sequencial guardado em `window.__lapRefs` (some quando a página navega). Valor
 * de campo nunca vai no rótulo, só o de botão.
 */
function coletarPagina(textoMax, elementosMax, rotuloMax) {
  const linha = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, rotuloMax) : '')
  const visivel = (el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && style.display !== 'none'
  }
  const papel = (el) => {
    const role = el.getAttribute('role')
    if (role) return role
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'botão'
    if (tag === 'select') return 'lista'
    if (tag === 'textarea') return 'campo de texto'
    if (tag === 'input') return `campo ${(el.getAttribute('type') || 'text').toLowerCase()}`
    return tag
  }
  const rotulo = (el) => {
    const tag = el.tagName.toLowerCase()
    const type = (el.getAttribute('type') || '').toLowerCase()
    const labels = el.labels ? [...el.labels].map((label) => label.innerText).join(' ') : ''
    const botao = tag === 'input' && (type === 'submit' || type === 'button' || type === 'reset') ? el.value : ''
    const texto = tag === 'input' || tag === 'select' || tag === 'textarea' ? '' : el.innerText
    return linha(el.getAttribute('aria-label') || labels || texto || botao || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '')
  }
  const refs = []
  const elementos = []
  for (const el of document.querySelectorAll('a, button, input, select, textarea, [role=button]')) {
    if (elementos.length >= elementosMax) break
    if (el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') continue
    if (!visivel(el)) continue
    refs.push(el)
    elementos.push({ ref: refs.length, rotulo: rotulo(el), papel: linha(papel(el)) })
  }
  window.__lapRefs = refs
  // O rótulo de cada `ref`, o mesmo do `ler`: volta no resultado de `clicar` e `digitar` (o passo no app diz em quê).
  window.__lapRotulos = elementos.map((elemento) => elemento.rotulo)
  const texto = document.body ? document.body.innerText.slice(0, textoMax) : ''
  return { titulo: document.title || '', url: location.href, texto, elementos }
}

/** Roda dentro da página: clica no elemento do `ref`, se ele ainda existir. */
function clicarNaPagina(ref, vencida) {
  const el = Array.isArray(window.__lapRefs) ? window.__lapRefs[ref - 1] : undefined
  if (!el || !el.isConnected) return { erro: vencida }
  const rotulo = Array.isArray(window.__lapRotulos) && typeof window.__lapRotulos[ref - 1] === 'string' ? window.__lapRotulos[ref - 1] : ''
  el.scrollIntoView({ block: 'center', inline: 'center' })
  el.click()
  return { ok: true, rotulo }
}

/** Roda dentro da página: escreve no campo do `ref` e avisa a página (`input` e `change`). Senha, nunca. */
function digitarNaPagina(ref, texto, vencida) {
  const el = Array.isArray(window.__lapRefs) ? window.__lapRefs[ref - 1] : undefined
  if (!el || !el.isConnected) return { erro: vencida }
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'password') return { erro: 'campo de senha: o app não digita senha' }
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return { erro: 'esse elemento não aceita texto' }
  if (el.disabled || el.readOnly) return { erro: 'o campo está bloqueado para edição' }
  el.focus()
  // Setter nativo do protótipo: campo controlado pelo React (ou parecido) vê a mudança no `input` a seguir.
  const prototipo = tag === 'textarea' ? HTMLTextAreaElement.prototype : tag === 'select' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototipo, 'value')?.set
  if (setter) setter.call(el, texto)
  else el.value = texto
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  const rotulo = Array.isArray(window.__lapRotulos) && typeof window.__lapRotulos[ref - 1] === 'string' ? window.__lapRotulos[ref - 1] : ''
  return { ok: true, rotulo }
}

/** Injeta `func` só no quadro principal da aba e devolve o que ela devolveu. */
async function naPagina(tab, func, args) {
  const [resultado] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args })
  const valor = resultado ? resultado.result : undefined
  if (valor && typeof valor.erro === 'string') throw new ErroComando(valor.erro)
  if (!valor) throw new ErroComando('a página não respondeu')
  return valor
}

async function ler(numero) {
  const { aba, tab } = await abaPropria(numero)
  return { aba, ...(await naPagina(tab, coletarPagina, [TEXTO_MAX, ELEMENTOS_MAX, ROTULO_MAX])) }
}

async function clicar(ref, numero) {
  const { aba, tab } = await abaPropria(numero)
  const { rotulo } = await naPagina(tab, clicarNaPagina, [ref, REF_VENCIDA])
  // O clique pode navegar: espera a página nova (se começou a carregar) antes de dizer onde está.
  await esperar(DEPOIS_DO_CLIQUE_MS)
  const depois = await abaPropria(aba)
  if (depois.tab.status === 'loading') await esperarCarregar(depois.tab.id)
  return { ok: true, aba, ...pagina((await abaPropria(aba)).tab), ...(rotulo ? { rotulo: rotulo.slice(0, ROTULO_MAX) } : {}) }
}

async function digitar(ref, texto, numero) {
  const { tab } = await abaPropria(numero)
  const { rotulo } = await naPagina(tab, digitarNaPagina, [ref, texto, REF_VENCIDA])
  return { ok: true, ...(rotulo ? { rotulo: rotulo.slice(0, ROTULO_MAX) } : {}) }
}

/** Com `aba`, fecha só ela; sem, a janela própria inteira. */
async function fechar(numero) {
  if (!janela) throw new ErroComando(JANELA_FECHADA)
  if (numero !== undefined) {
    const { aba, tab } = await abaPropria(numero)
    esquecerAba(aba)
    await chrome.tabs.remove(tab.id).catch(() => undefined)
    return { ok: true }
  }
  const windowId = janela.windowId
  esquecerJanela()
  await chrome.windows.remove(windowId).catch(() => undefined)
  return { ok: true }
}

const isRef = (value) => Number.isInteger(value) && value >= 1 && value <= ELEMENTOS_MAX
/** `aba` é opcional; quando vem, um inteiro positivo. */
const isAba = (value) => value === undefined || (Number.isInteger(value) && value >= 1)

/** Executa um comando já conferido pelo app; confere de novo o formato aqui, por garantia. */
async function executar(comando) {
  switch (comando.tipo) {
    case 'abrir':
      return abrir(comando.url)
    case 'abas':
      return listarAbas()
    case 'ler':
      if (!isAba(comando.aba)) throw new ErroComando(ABA_NAO_EXISTE)
      return ler(comando.aba)
    case 'clicar':
      if (!isRef(comando.ref)) throw new ErroComando('ref inválida')
      if (!isAba(comando.aba)) throw new ErroComando(ABA_NAO_EXISTE)
      return clicar(comando.ref, comando.aba)
    case 'digitar':
      if (!isRef(comando.ref) || typeof comando.texto !== 'string') throw new ErroComando('pedido inválido')
      if (!isAba(comando.aba)) throw new ErroComando(ABA_NAO_EXISTE)
      return digitar(comando.ref, comando.texto, comando.aba)
    case 'aguardar':
      if (!Number.isInteger(comando.segundos) || comando.segundos < 1 || comando.segundos > 10) throw new ErroComando('pedido inválido')
      await esperar(comando.segundos * 1000)
      return { ok: true }
    case 'fechar':
      if (!isAba(comando.aba)) throw new ErroComando(ABA_NAO_EXISTE)
      return fechar(comando.aba)
    default:
      throw new ErroComando('comando desconhecido')
  }
}

async function pedir(candidate, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`http://127.0.0.1:${candidate}${init.path}`, {
      method: init.method,
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!response.ok) return null
    const reply = await response.json().catch(() => null)
    return reply && typeof reply === 'object' ? reply : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Um GET de long-poll na porta boa (ou procura nas 10). `null`: o app não respondeu em nenhuma. */
async function proximoComando() {
  const order = port === null ? PORTS : [port, ...PORTS.filter((candidate) => candidate !== port)]
  for (const candidate of order) {
    const reply = await pedir(candidate, { method: 'GET', path: COMANDOS_PATH }, POLL_TIMEOUT_MS)
    if (reply) {
      port = candidate
      return reply
    }
  }
  port = null
  return null
}

async function responder(candidate, resultado) {
  await pedir(candidate, { method: 'POST', path: RESULTADOS_PATH, body: JSON.stringify(resultado) }, POST_TIMEOUT_MS)
}

const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length

/**
 * Resultado que caiba no limite do app (em bytes, depois do JSON): a cada volta, corta pela metade o maior dos dois,
 * os elementos ou o texto. Sem isso, o app recusaria o corpo e só daria "não respondeu a tempo" 30 s depois.
 */
function caber(resultado) {
  let atual = resultado
  for (let volta = 0; volta < 40 && bytes(atual) > CORPO_MAX_BYTES; volta++) {
    const dados = atual.dados
    if (!dados || typeof dados !== 'object') break
    const temElementos = Array.isArray(dados.elementos) && dados.elementos.length > 0
    const temTexto = typeof dados.texto === 'string' && dados.texto.length > 0
    const elementosMaior = temElementos && (!temTexto || bytes(dados.elementos) >= bytes(dados.texto))
    if (elementosMaior) {
      atual = { ...atual, dados: { ...dados, elementos: dados.elementos.slice(0, Math.floor(dados.elementos.length / 2)) } }
    } else if (typeof dados.texto === 'string' && dados.texto.length > 0) {
      atual = { ...atual, dados: { ...dados, texto: dados.texto.slice(0, Math.floor(dados.texto.length / 2)) } }
    } else break
  }
  return atual
}

async function atender(candidate, comando) {
  if (!comando || typeof comando.id !== 'string' || typeof comando.tipo !== 'string') return
  await pronto
  try {
    const dados = await executar(comando)
    await responder(candidate, caber({ id: comando.id, ok: true, dados }))
  } catch (error) {
    const erro = error instanceof ErroComando ? error.message : `falhou: ${error && error.message ? error.message : String(error)}`
    await responder(candidate, { id: comando.id, ok: false, erro: erro.slice(0, ERRO_MAX) })
  } finally {
    // `janela` e `ativa` mudam dentro dos comandos (abrir, a aba usada): o estado fica gravado como terminou.
    salvar()
  }
}

/** O laço: pede, executa, devolve; sem o app, tenta de novo a cada 5 s. */
async function iniciar() {
  if (rodando) return
  rodando = true
  try {
    for (;;) {
      // Uma chamada à API da extensão a cada volta mantém o service worker acordado entre os GETs.
      await chrome.runtime.getPlatformInfo()
      const reply = await proximoComando()
      if (!reply) {
        await esperar(RETRY_MS)
        continue
      }
      if (reply.comando && port !== null) await atender(port, reply.comando)
    }
  } finally {
    rodando = false
  }
}

// O service worker acorda ao abrir o Chrome, ao instalar e com o movimento das abas; o laço sobe em qualquer um.
chrome.runtime.onStartup.addListener(() => void iniciar())
chrome.runtime.onInstalled.addListener(() => void iniciar())
chrome.tabs.onActivated.addListener(() => void iniciar())
void iniciar()
