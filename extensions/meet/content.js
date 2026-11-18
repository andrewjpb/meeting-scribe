// LAP Reuniões — Quem fala no Meet (contrato 27, CA1). Roda só em https://meet.google.com/*.
//
// Lê, sem mexer em nada da página, (a) os nomes visíveis dos participantes e (b) quem começou ou parou de falar,
// pelo indicador visual de fala de cada participante. Não lê legendas, não injeta nada e não altera o DOM: só
// consulta. O que vê vai ao `background.js` por `chrome.runtime.sendMessage`; ele junta e manda ao app.
//
// O arquivo tem duas partes:
// 1. `LEITOR_MEET`: tudo o que conhece o DOM do Meet (seletores, id da reunião, leitura da página). O DOM do Meet
//    muda sem aviso; quando mudar, é só aqui que se ajusta (confira no DevTools da chamada, aba Elements).
// 2. O motor genérico (observador, varredura, envio), que só conhece a interface do leitor:
//    `{ id(): string | null, read(): { participantes: string[], falando: Set<string> } }`.
// Um leitor do Teams (ou de outra plataforma) entra como outro objeto com a mesma interface; o motor e o protocolo
// com o app não mudam.
'use strict'

// ===============================================================================================================
// 1. Leitor do Google Meet (melhor esforço, conferido por fora em 11/2026; ajustar no teste real)
// ===============================================================================================================

const LEITOR_MEET = {
  /** Tile de cada participante na grade da chamada. O Meet marca o tile com o id do participante. */
  TILE_SELECTORS: ['div[data-participant-id]', 'div[data-requested-participant-id]'],

  /**
   * Linha de cada pessoa no painel "Pessoas" (quando aberto). Pega também quem está fora da grade (chamadas
   * grandes). O nome costuma estar no `aria-label` da linha.
   */
  PEOPLE_ROW_SELECTORS: ['[role="list"][aria-label] [role="listitem"][aria-label]', 'div[data-participant-id][role="listitem"]'],

  /** Nome dentro do tile, em ordem de preferência. Sem nenhum, cai no `aria-label` do próprio tile. */
  NAME_SELECTORS: ['[data-self-name]', '.zWGUib', '.XEazBc', '[jsname="YQmeIe"]', 'span.notranslate'],

  /**
   * Indicador de fala: o Meet anima as barrinhas de áudio (ou a borda) do tile de quem fala trocando a classe de
   * um elemento dentro dele. Qualquer descendente com uma destas classes conta como "falando"...
   */
  SPEAKING_CLASSES: ['Oaajhc', 'HX2H7', 'wEsLMd', 'OgVli'],
  /** ...a não ser que o mesmo elemento tenha também a classe de silêncio. */
  SILENT_CLASSES: ['gjg47c'],

  /**
   * O próprio usuário. Atenção: o atributo `data-self-name` pode estar no elemento de nome de TODOS os tiles, com o
   * valor "Você" (traduzido) — a mera presença dele não diz nada. É "eu" só quando o texto do nome é igual ao valor
   * do atributo no próprio elemento (o tile do usuário mostra "Você"), ou quando o nome termina com "(Você)"/"(You)".
   */
  SELF_ATTRIBUTE: 'data-self-name',
  SELF_SUFFIX: /\s*\((você|voce|you|eu|me)\)\s*$/i,

  /** Tile de apresentação de tela ("Ana (Apresentação)"): o nome é o mesmo da pessoa, sem o sufixo. */
  PRESENTATION_SUFFIX: /\s*\((apresenta(ção|cao|ndo)|presentation|presenting)\)\s*$/i,

  NAME_MAX: 80,
  PARTICIPANTS_MAX: 100,

  /** Id da reunião na URL (`/abc-defg-hij`); fora de uma chamada, `null` e nada é mandado. */
  id() {
    const match = /^\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})(?:$|[/?#])/.exec(location.pathname)
    return match ? match[1] : null
  },

  cleanName(raw) {
    if (typeof raw !== 'string') return ''
    let name = raw.replace(/\s+/g, ' ').replace(this.SELF_SUFFIX, '').replace(this.PRESENTATION_SUFFIX, '').trim()
    // O Meet repete o nome em elementos aninhados do tile; o textContent vira "Ana RochaAna Rocha"
    // (ou "Ana Rocha Ana Rocha"). Visto no teste real de 18/11/2026: corta a duplicação pela metade.
    for (let guard = 0; guard < 3; guard += 1) {
      const half = name.slice(0, Math.floor(name.length / 2))
      if (half && (name === half + half || name === `${half} ${half.trim()}`.replace(/\s+/g, ' '))) name = half.trim()
      else break
    }
    return name.slice(0, this.NAME_MAX).trim()
  },

  firstMatch(root, selectors) {
    for (const selector of selectors) {
      try {
        const found = root.querySelector(selector)
        if (found) return found
      } catch {
        // Seletor inválido nesta versão do Chrome: tenta o próximo.
      }
    }
    return null
  },

  allMatches(selectors) {
    const found = new Set()
    for (const selector of selectors) {
      try {
        for (const element of document.querySelectorAll(selector)) found.add(element)
      } catch {
        // idem
      }
    }
    return [...found]
  },

  /** Texto cru do nome do tile (antes de limpar), ou o `aria-label` dele. */
  rawName(element) {
    const label = this.firstMatch(element, this.NAME_SELECTORS)
    return (label ? label.textContent : '') || element.getAttribute('aria-label') || ''
  },

  nameOf(element) {
    return this.cleanName(this.rawName(element))
  },

  isSelf(element) {
    // Só o elemento cujo texto é igual ao próprio `data-self-name` (ver o comentário de SELF_ATTRIBUTE).
    const marked = [element, ...element.querySelectorAll(`[${this.SELF_ATTRIBUTE}]`)].filter((node) => node.hasAttribute && node.hasAttribute(this.SELF_ATTRIBUTE))
    for (const node of marked) {
      const value = (node.getAttribute(this.SELF_ATTRIBUTE) || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
      if (value && text === value) return true
    }
    return this.SELF_SUFFIX.test(this.rawName(element).replace(/\s+/g, ' ').trim())
  },

  hasAnyClass(element, classes) {
    for (const name of classes) if (element.classList.contains(name)) return true
    return false
  },

  isSpeaking(element) {
    const selector = this.SPEAKING_CLASSES.map((name) => `.${name}`).join(',')
    for (const indicator of element.querySelectorAll(selector)) {
      if (!this.hasAnyClass(indicator, this.SILENT_CLASSES)) return true
    }
    return false
  },

  /** Uma leitura da página: participantes visíveis e quem fala agora (sem o próprio usuário: ele é o microfone). */
  read() {
    const participantes = []
    const falando = new Set()
    const seen = new Set()
    for (const element of [...this.allMatches(this.TILE_SELECTORS), ...this.allMatches(this.PEOPLE_ROW_SELECTORS)]) {
      const name = this.nameOf(element)
      if (!name) continue
      if (!seen.has(name) && participantes.length < this.PARTICIPANTS_MAX) {
        seen.add(name)
        participantes.push(name)
      }
      if (!this.isSelf(element) && this.isSpeaking(element)) falando.add(name)
    }
    return { participantes, falando }
  },
}

// ===============================================================================================================
// 2. Motor genérico: observa a página, compara leituras e manda ao background. Só usa `leitor.id()` e `leitor.read()`.
// ===============================================================================================================

/** Varredura periódica (o MutationObserver pede varreduras extras, no máximo uma a cada `OBSERVER_GAP_MS`). */
const SCAN_INTERVAL_MS = 1000
const OBSERVER_GAP_MS = 250

function startEngine(leitor) {
  let previous = new Set()
  let previousParticipants = ''
  let lastObserverScan = 0
  let observerTimer = null

  function send(message) {
    try {
      // Sem esperar resposta: a página nunca fica presa à extensão.
      chrome.runtime.sendMessage(message).catch(() => undefined)
    } catch {
      // Extensão recarregada ou desligada: a página segue normalmente.
    }
  }

  /**
   * Compara com a leitura anterior e manda o que mudou. Na varredura periódica (`heartbeat`), manda mesmo sem
   * mudança (mantém "conectado") e repete "começou a falar" de quem fala agora: o app ignora o repetido de quem já
   * está falando, e ele reabre a fala depois de uma pausa da gravação sem esperar a próxima troca.
   */
  function scan(heartbeat) {
    const reuniao = leitor.id()
    if (!reuniao) return
    const { participantes, falando } = leitor.read()
    const ts = Date.now()
    const eventos = []
    for (const name of falando) if (heartbeat || !previous.has(name)) eventos.push({ nome: name, falando: true, ts })
    for (const name of previous) if (!falando.has(name)) eventos.push({ nome: name, falando: false, ts })
    previous = falando
    const key = participantes.join('\n')
    const changed = key !== previousParticipants
    previousParticipants = key
    // Fora da chamada (sala de espera, tela inicial): nenhum participante, nada a mandar.
    if (!participantes.length && !eventos.length) return
    if (eventos.length || changed || heartbeat) send({ tipo: 'meet', reuniao, participantes, eventos })
  }

  const observer = new MutationObserver(() => {
    if (observerTimer !== null) return
    const wait = Math.max(0, OBSERVER_GAP_MS - (Date.now() - lastObserverScan))
    observerTimer = setTimeout(() => {
      observerTimer = null
      lastObserverScan = Date.now()
      scan(false)
    }, wait)
  })

  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-label'] })
  setInterval(() => scan(true), SCAN_INTERVAL_MS)
}

startEngine(LEITOR_MEET)
