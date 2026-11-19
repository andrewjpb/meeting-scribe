// LAP Reuniões — Quem fala no Meet e no Teams (contratos 27 e 41). Roda só em https://meet.google.com/*,
// https://teams.microsoft.com/* e https://teams.live.com/* (o Teams aberto no Chrome; o app do Teams não tem como).
//
// Lê, sem mexer em nada da página, (a) os nomes visíveis dos participantes e (b) quem começou ou parou de falar,
// pelo indicador visual de fala de cada participante. Não lê legendas, não injeta nada e não altera o DOM: só
// consulta. O que vê vai ao `background.js` por `chrome.runtime.sendMessage`; ele junta e manda ao app.
//
// O arquivo tem três partes:
// 1. `LEITOR_MEET`: tudo o que conhece o DOM do Meet (seletores, id da reunião, leitura da página). O DOM do Meet
//    muda sem aviso; quando mudar, é só aqui que se ajusta (confira no DevTools da chamada, aba Elements).
// 2. `LEITOR_TEAMS` (contrato 41): o mesmo para o Teams web, com a mesma interface. Reaproveita o `cleanName` e os
//    utilitários do Meet.
// 3. O motor genérico (observador, varredura, envio), que só conhece a interface do leitor:
//    `{ id(): string | null, read(): { participantes: string[], falando: Set<string> }, titulo(reuniao): string | null,
//    plataforma: 'meet' | 'teams' }`.
// O leitor é escolhido pelo endereço da aba (`location.hostname`); o motor e o protocolo com o app não mudam.
//
// Contrato 48: cada envio leva também `plataforma` ('meet' ou 'teams', do leitor escolhido) e `titulo`, o título da
// reunião como a aba mostra (`document.title` limpo: só texto, numa linha, até 120 caracteres; sem título próprio,
// nada). O app usa os dois no aviso "Começar a transcrever". É dado da página, nunca HTML.
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
  TITLE_MAX: 120,

  /** Contrato 48: de onde é a reunião, no envio ao app. */
  plataforma: 'meet',

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

  /** Título de aba numa linha só, sem caractere de controle, cortado em 120 caracteres. */
  cleanTitle(raw) {
    if (typeof raw !== 'string') return ''
    return Array.from(raw, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
  },

  /**
   * Contrato 48: título da reunião pela aba. O Meet mostra "Meet - <título do evento>" (ou "Meet - abc-defg-hij"
   * sem evento); sem título próprio, `null` (o app mostra "Reunião no Meet").
   */
  titulo(reuniao) {
    const text = this.cleanTitle(document.title).replace(/^(google\s+)?meet\s*[-–—:|]\s*/i, '').slice(0, this.TITLE_MAX).trim()
    if (!text || text === reuniao || /^(google\s+)?meet$/i.test(text)) return null
    return text
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
// 2. Leitor do Microsoft Teams web (contrato 41; melhor esforço, montado sem reunião real: TODOS os seletores abaixo
//    são palpite até a calibração numa chamada do Teams no Chrome)
// ===============================================================================================================

const LEITOR_TEAMS = {
  /**
   * Tile de cada participante no palco da chamada. O Teams marca os elementos com `data-tid`/`data-cid`; o nome
   * costuma vir no `aria-label` do tile ("Ana Rocha, câmera desligada, microfone mudo").
   */
  TILE_SELECTORS: ['[data-cid="calling-participant-stream"]', '[data-tid="video-tile"]', '[data-stream-type][aria-label]'],

  /**
   * Linha de cada pessoa no painel "Pessoas"/"Participantes" (quando aberto). Fica preso ao painel de propósito: a
   * lista de conversas do Teams também é uma árvore de `treeitem`, e os nomes dela não são da reunião.
   */
  ROSTER_ROW_SELECTORS: [
    '[data-tid^="participantsInCall-"]',
    '[data-cid="roster-participant"]',
    '[aria-label="Participantes"] [role="treeitem"]',
    '[aria-label="Participants"] [role="treeitem"]',
  ],

  /** Nome dentro do tile ou da linha, em ordem de preferência. Sem nenhum, cai no `aria-label` (até a 1ª vírgula). */
  NAME_SELECTORS: ['[data-tid="display-name"]', '[data-tid="roster-participant-name"]', '[data-tid="participant-name"]', 'span[title]'],

  /** Cabeçalhos dos grupos do painel ("Na reunião (3)", "Outros convidados"): também são `treeitem`, não são gente. */
  NOT_A_NAME: /^(na reunião|na reuniao|in this meeting|in the meeting|in meeting|outros convidados|others invited|convidados|participantes|participants|sala de espera|lobby|waiting in lobby)\b/i,

  /**
   * Indicador de fala, no próprio tile/linha ou dentro dele: o anel/realce do tile de quem fala (o contorno
   * `voice-level-stream-outline` ganha uma classe enquanto a pessoa fala) ou um atributo de "está falando".
   */
  SPEAKING_SELECTORS: [
    '[data-tid="voice-level-stream-outline"].vdi-frame-occlusion',
    '[data-is-speaking="true"]',
    '[data-speaking="true"]',
    '[data-tid="speaking-indicator"]',
  ],
  /** Texto de acessibilidade do indicador de voz ("Ana está falando" / "Ana is speaking")... */
  SPEAKING_LABEL: /\b(falando|speaking)\b/i,
  /** ...que não conta quando nega ("não está falando" / "not speaking"). */
  NOT_SPEAKING_LABEL: /(não|nao|not)\s+(está\s+|esta\s+|is\s+)?(falando|speaking)/i,

  /**
   * O próprio usuário: o painel mostra "Ana (Você)"/"Ana (You)" (o mesmo `SELF_SUFFIX` do Meet), e o tile do
   * próprio vídeo tem marca própria.
   */
  SELF_SUFFIX: LEITOR_MEET.SELF_SUFFIX,
  SELF_SELECTORS: ['[data-cid="calling-self-stream"]', '[data-tid="self-video"]', '[data-tid="local-video"]'],

  /** Sufixos do Teams que não fazem parte do nome ("Ana (Convidado)", "Ana (Externo)", "Ana (Organizador)"). */
  EXTRA_SUFFIX: /\s*\((convidad[oa]|guest|extern[oa]|external|não verificad[oa]|nao verificad[oa]|unverified|organizador[a]?|organizer)\)\s*$/i,

  /** Sinal de que está dentro da chamada (o botão "Sair"); só com ele o id cai no hash do endereço. */
  IN_CALL_SELECTORS: ['#hangup-button', '[data-tid="hangup-main-btn"]', '[data-tid="call-hangup"]', 'button[aria-label^="Sair" i]', 'button[aria-label^="Leave" i]'],

  PARTICIPANTS_MAX: LEITOR_MEET.PARTICIPANTS_MAX,

  /** Contrato 48: de onde é a reunião, no envio ao app. */
  plataforma: 'teams',

  /** Títulos de aba do Teams que não são o nome de uma reunião (telas do app, ou a reunião sem nome). */
  NOT_A_TITLE: /^(microsoft teams|teams|chat|bate-papo|calendário|calendario|calendar|atividade|activity|equipes|reunião|reuniao|meeting|meet|chamada|call)$/i,

  /**
   * Contrato 48: título da reunião pela aba. O Teams mostra "<título> | Microsoft Teams", às vezes com o número de não
   * lidas na frente ("(2) …"); sem título próprio, `null` (o app mostra "Reunião no Teams").
   */
  titulo() {
    const text = LEITOR_MEET.cleanTitle(document.title)
      .replace(/^\(\d+\)\s*/, '')
      .replace(/\s*[|–—-]\s*microsoft teams.*$/i, '')
      .slice(0, LEITOR_MEET.TITLE_MAX)
      .trim()
    if (!text || this.NOT_A_TITLE.test(text)) return null
    return text
  },

  /** Último id achado no endereço: o Teams troca a URL depois de entrar, e a reunião continua a mesma. Zera fora da chamada. */
  lastId: null,

  /**
   * Id da reunião: o id da conversa da reunião (`19:meeting_…@thread.v2`) quando a URL o traz (link de entrada);
   * no teams.live.com, o número de `/meet/<número>`; senão, dentro da chamada, o último achado ou um hash do
   * caminho da URL. Fora de uma chamada (e sem id na URL), `null` e nada é mandado.
   */
  id() {
    let href = location.href
    try {
      href = decodeURIComponent(href)
    } catch {
      // URL com escape quebrado: procura no texto cru.
    }
    const thread = /19:meeting_[A-Za-z0-9_-]+@thread\.v2/.exec(href)
    const live = /\/meet\/(\d{6,})/.exec(location.pathname)
    const found = thread ? thread[0] : live ? `teams-live-${live[1]}` : null
    if (found) {
      this.lastId = found
      return found
    }
    if (!LEITOR_MEET.firstMatch(document, this.IN_CALL_SELECTORS)) {
      // Saiu da chamada: a próxima (na mesma aba) não herda o id desta.
      this.lastId = null
      return null
    }
    return this.lastId || `teams-${this.hash(location.pathname)}`
  },

  /** Hash curto e estável de um texto (djb2), só para o id de reserva. */
  hash(text) {
    let value = 5381
    for (let i = 0; i < text.length; i += 1) value = ((value * 33) ^ text.charCodeAt(i)) >>> 0
    return value.toString(36)
  },

  /** O mesmo `cleanName` do Meet (com o corte de duplicação), depois de tirar os sufixos do Teams. */
  cleanName(raw) {
    if (typeof raw !== 'string') return ''
    const name = LEITOR_MEET.cleanName(raw.replace(/\s+/g, ' ').trim().replace(this.EXTRA_SUFFIX, ''))
    return LEITOR_MEET.cleanName(name.replace(this.EXTRA_SUFFIX, ''))
  },

  /** Texto cru do nome: o elemento de nome; senão o `title`; senão o `aria-label` até a 1ª vírgula. */
  rawName(element) {
    const label = LEITOR_MEET.firstMatch(element, this.NAME_SELECTORS)
    const text = label ? label.textContent || label.getAttribute('title') || '' : ''
    if (text.trim()) return text
    return (element.getAttribute('aria-label') || '').split(',')[0]
  },

  nameOf(element) {
    const name = this.cleanName(this.rawName(element))
    return this.NOT_A_NAME.test(name) ? '' : name
  },

  /** O elemento ou um descendente casa com algum dos seletores. */
  matchesAny(element, selectors) {
    for (const selector of selectors) {
      try {
        if (element.matches(selector) || element.querySelector(selector)) return true
      } catch {
        // Seletor inválido nesta versão do Chrome: tenta o próximo.
      }
    }
    return false
  },

  isSelf(element) {
    if (this.matchesAny(element, this.SELF_SELECTORS)) return true
    return this.SELF_SUFFIX.test(this.rawName(element).replace(/\s+/g, ' ').trim())
  },

  isSpeaking(element) {
    if (this.matchesAny(element, this.SPEAKING_SELECTORS)) return true
    for (const node of [element, ...element.querySelectorAll('[aria-label]')]) {
      const label = node.getAttribute('aria-label') || ''
      if (this.SPEAKING_LABEL.test(label) && !this.NOT_SPEAKING_LABEL.test(label)) return true
    }
    return false
  },

  /** Uma leitura da página: participantes visíveis e quem fala agora (sem o próprio usuário: ele é o microfone). */
  read() {
    const participantes = []
    const falando = new Set()
    const seen = new Set()
    for (const element of [...LEITOR_MEET.allMatches(this.TILE_SELECTORS), ...LEITOR_MEET.allMatches(this.ROSTER_ROW_SELECTORS)]) {
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
// 3. Motor genérico: observa a página, compara leituras e manda ao background. Só usa `leitor.id()`, `leitor.read()`,
//    `leitor.titulo()` e `leitor.plataforma` (contrato 48).
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
    if (eventos.length || changed || heartbeat) send({ tipo: 'meet', reuniao, participantes, eventos, plataforma: leitor.plataforma, titulo: leitor.titulo(reuniao) })
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

/** Qual leitor serve a esta aba, pelo endereço (os mesmos do `manifest.json`). */
const LEITORES = [
  { hosts: ['meet.google.com'], leitor: LEITOR_MEET },
  { hosts: ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft'], leitor: LEITOR_TEAMS },
]

const escolhido = LEITORES.find((entry) => entry.hosts.includes(location.hostname))
if (escolhido) startEngine(escolhido.leitor)
