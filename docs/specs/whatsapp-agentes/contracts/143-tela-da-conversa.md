# Contrato 143 — Atendimento no WhatsApp: painel da conversa, selos, proposta, pausa geral e aviso de risco

Feature: whatsapp-agentes  ·  Wave: 5  ·  Depende de: 142

Constituição: `CLAUDE.md` do usuário e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Contrato 142 aceito e commitado: existe `features/atendimento/atendimentoStore.ts` (`useAtendimento`) com
  `state`, `runtime`, `log`, `saveBinding`, `deleteBinding`, `pauseAll`, `acceptRisk`, `discardDraft`, `loadLog`, `setLogChatId`.
- Desenho aprovado pelo Andrew em 23/11/2026: `docs/specs/whatsapp-agentes/mockups/png/01-painel-atendimento-claro.png`,
  `-escuro.png`, `02-rascunho-claro.png`, `03-estados-do-selo-claro.png`, `06-aviso-de-risco-claro.png`
  (fonte: `mockups/WhatsAppAtendimento.dc.html`). Em dúvida de aparência, vale o mockup; de texto, este contrato.
- `pnpm typecheck && pnpm lint && pnpm test` verdes.

## Contexto mínimo
Na tela do WhatsApp (`features/whatsapp/WhatsAppScreen.tsx`), cada conversa individual ganha um painel
"Atendimento" com as opções **daquela conversa**. Modelos a seguir, sem inventar outro: o painel
`DetailsPanel.tsx` (`aside` de 300 px, cabeçalho de 44 px com X), o botão "Detalhes" do cabeçalho da conversa
(`data-action="toggle-whatsapp-details"`, `aria-pressed`), o painel do rascunho do Claude acima do campo
(`data-whatsapp-draft-panel`), o `RiskPanel.tsx` (caixa "Entendo…" que habilita o botão) e o envio com clique
(`sendNow`: a chamada ao preload sai direto do `onClick`, porque o preload exige `navigator.userActivation.isActive`).
A proposta do agente é enviada por `window.__scribeApi.atendimentoDraftSend({ chatId, text })`.
Grupos (`isGroupChat(chatId)`, `shared/atendimento.ts`) não têm atendimento.

## Superfície
- Criar em `apps/desktop/src/renderer/src/features/atendimento/`: `AtendimentoPanel.tsx`, `AtendimentoRisk.tsx`,
  `AtendimentoBadge.tsx`, `AtendimentoProposal.tsx`, `status.ts`.
- Alterar `features/whatsapp/WhatsAppScreen.tsx` (botão e painel, selo no cabeçalho e na lista, proposta, barra de pausa, marca nas mensagens do agente). Pode extrair pedaços para arquivos novos em `features/whatsapp/` se ajudar; `DetailsPanel.tsx` não muda.
- Mover `isWithinHours` de `main/whatsapp/atendimento/scheduler.ts` para `shared/atendimento.ts` (função pura), reexportando-a do `scheduler.ts` para nada mais mudar.
- Criar `apps/desktop/test/renderer/atendimento-status.test.ts`.

### Função pura (`status.ts`)
```ts
type BadgeKind = 'off' | 'all-paused' | 'handed-off' | 'proposed' | 'scheduled' | 'paused' | 'out-of-hours' | 'attending'
atendimentoStatus(input: {
  binding: AtendimentoBinding | undefined; pausedAll: boolean
  runtime: AtendimentoRuntime[string] | undefined; now: Date
}): { kind: BadgeKind; label: string } | null
repliesToday(log: AtendimentoLogEntry[], chatId: string, now: Date): number
agentMessageIds(log: AtendimentoLogEntry[]): Map<string, string>   // messageId → agentId, de 'sent' e 'draft-sent'
bindingDraft(binding: AtendimentoBinding | undefined): campos do formulário   // defaults de ATENDIMENTO_BINDING_DEFAULTS
```

## Critérios de aceite

### Estado do selo (testes, um por linha; a ordem abaixo é a precedência)
- CA1. Sem atendimento para a conversa → `null`.
- CA2. `enabled: false` → `off`, "desligado".
- CA3. `pausedAll: true` → `all-paused`, "todos pausados".
- CA4. `runtime.handedOffAt` preenchido → `handed-off`, "passou para você".
- CA5. `runtime.draft` preenchido → `proposed`, "propôs uma resposta".
- CA6. `runtime.dueAt` no futuro → `scheduled`, "responde em N min" (arredonda para cima; menos de 1 min → "responde em instantes").
- CA7. `pausedUntil` no futuro → `paused`, "pausado até HH:MM" (hora local; em outro dia, "pausado até DD/MM HH:MM"). `pausedUntil` no passado é ignorado.
- CA8. Fora de `hours` (por `isWithinHours`) → `out-of-hours`, "fora do horário".
- CA9. Nenhum dos anteriores → `attending`, "atendendo".
- CA10. `repliesToday` conta as linhas `sent` e `draft-sent` daquela conversa no dia local de `now`. `agentMessageIds` ignora linhas sem `messageId`. `isWithinHours` continua com os testes do contrato 140 passando sem alteração de comportamento.

### Cabeçalho e painel
- CA11. Em conversa individual, o cabeçalho ganha o botão "Atendimento" (`data-action="toggle-whatsapp-atendimento"`, `aria-pressed`, ícone `Bot`), à esquerda de "Detalhes", com a mesma classe dele. Em grupo, o botão não aparece.
- CA12. Só um painel lateral por vez: abrir "Atendimento" fecha "Detalhes" e vice-versa. `toggle-whatsapp-details`, seu `aria-pressed` e o comportamento de largura (`detailsStartOpen`, 1280 px) continuam iguais; o painel Atendimento nunca abre sozinho.
- CA13. Painel `aside[data-wa-atendimento][aria-label="Atendimento"]` de 300 px, com cabeçalho "Atendimento" e X (`aria-label="Fechar o painel Atendimento"`). Trocar de conversa com o painel aberto recarrega o formulário com os dados da nova conversa; em grupo, o painel fecha.
- CA14. Sem nenhum agente criado: o painel mostra só "Crie um agente de atendimento antes de marcar esta conversa." e o botão "Criar agente", que leva a Automações › Atendimento.
- CA15. Formulário, nesta ordem e com estes textos:
  - Interruptor "Atender esta conversa"; abaixo, "N respostas hoje" (`repliesToday`) quando há atendimento salvo.
  - Nota: "Só responde com o app aberto e o Mac acordado."
  - "Agente" (`Select` com os agentes).
  - "Modo", duas opções empilhadas: "Rascunho para eu aprovar" e "Responder sozinho".
  - "Responder depois de" [mín] "a" [máx] "minutos" + "Sorteado a cada resposta. Iguais, o atraso é fixo."
  - Interruptor "Mostrar “digitando…” antes de enviar".
  - Interruptor "Apresenta-se como assistente" + "A primeira resposta do dia começa com “Aqui é o assistente”."
  - "Quem é esta pessoa" (textarea, máximo 1.000).
  - "Horário de atendimento": "Sempre" / "Escolher"; em "Escolher", os sete dias (S T Q Q S S D, cada um com nome acessível completo, segunda primeiro) e "HH:MM" "às" "HH:MM".
  - "Limite de respostas por hora" [n] "por hora, nesta conversa".
  - "Pausar quando eu responder" [n] "minutos".
  - "Salvar" (`data-action="atendimento-binding-save"`), "Cancelar" (volta aos valores salvos) e o link "Ver histórico".
  Conversa nova começa com `ATENDIMENTO_BINDING_DEFAULTS` e o primeiro agente da lista. Limites numéricos vêm das constantes de `shared/atendimento.ts`.
- CA16. "Salvar" fica desabilitado com atraso máximo menor que o mínimo, número fora do limite ou "Escolher" sem nenhum dia; a frase do problema aparece junto do campo. Erro do store aparece em `Note role="alert"`. Depois de salvar, uma confirmação discreta "Salvo." e o selo se atualiza.
- CA17. Com atendimento `pausedUntil` no futuro, o painel mostra "Pausado até HH:MM porque você respondeu." e o botão "Retomar agora", que salva com `pausedUntil` limpo (pelo caminho que o store do main oferecer; se `binding-save` não limpar a pausa, pare e relate em vez de criar canal).
- CA18. "Ver histórico" abre Automações › aba Atendimento com o filtro do histórico naquela conversa (`setLogChatId`).

### Aviso de risco
- CA19. "Salvar" com modo "Responder sozinho", atendimento ligado e `state.riskAcceptedAt === null` **não salva**: o painel troca o formulário pelo aviso (`data-atendimento-risk`), com: título "Antes de deixar um agente responder sozinho"; "O WhatsApp do app funciona com um cliente não oficial. Responder mensagens de forma automática aumenta a chance de o WhatsApp suspender ou bloquear o seu número, às vezes sem aviso."; "Para diminuir o risco, nesta conversa o agente:" e a lista com os valores do formulário ("espera de X a Y minutos antes de responder;" ou "responde sem espera;" com 0 a 0; "mostra “digitando…” antes de enviar;" só se ligado; "responde no máximo N vezes por hora."); "Mesmo assim o risco continua. Se preferir, use o modo Rascunho: o agente só propõe e quem envia é você."; caixa "Entendo o risco e quero continuar"; "Este aviso aparece só antes do primeiro atendimento automático."
- CA20. "Ligar atendimento" (`data-action="atendimento-risk-accept"`) fica desabilitado até marcar a caixa; ao clicar, chama `acceptRisk()` e em seguida `saveBinding` com os valores do formulário. "Cancelar" volta ao formulário com os valores digitados, sem salvar nem aceitar.
- CA21. Se `saveBinding` devolver `risk-required` por qualquer outro caminho, o mesmo aviso abre.

### Selos
- CA22. Cabeçalho da conversa: à direita do nome, `[data-atendimento-badge]` com "<nome do agente> · <label>" de `atendimentoStatus`. `handed-off` usa o fundo `--accent`; `paused`, `out-of-hours`, `off` e `all-paused` usam `--text-muted`; os demais, `--accent` no texto. O texto completo vai no `title` e no nome acessível.
- CA23. Lista de conversas: cada `ChatRow` com atendimento ligado mostra, na linha da prévia, uma etiqueta de 18 px (`data-atendimento-chip`) com o nome do agente e o ícone do estado, sem empurrar hora nem contador de não lidas; nome longo corta com reticências. Atendimento desligado não mostra etiqueta.
- CA24. O selo de `scheduled` e de `paused` se atualiza sozinho com o passar do tempo (relógio de no máximo 30 s, só enquanto a tela do WhatsApp está montada).

### Pausa geral
- CA25. Abaixo da busca da lista, quando existe pelo menos um atendimento ligado: "N atendida(s)" e o botão "Pausar todos os atendimentos" (`data-action="atendimento-pause-all"`). Com `pausedAll`, o texto vira "Todos os atendimentos pausados" (contorno tracejado) e o botão "Retomar atendimentos". Um clique, sem confirmação. Sem nenhum atendimento ligado, a barra não aparece.

### Proposta do agente
- CA26. Com `runtime[chatId].draft`, aparece acima do campo de mensagem a caixa `[data-atendimento-proposal]` (barra de 3 px em `--accent`): "<agente> propôs uma resposta", a hora relativa, o texto num campo editável (máximo 1.000), "Enviar" (`data-action="atendimento-draft-send"`), "Descartar" (`data-action="atendimento-draft-discard"`) e "Nada sai sem o seu clique."
- CA27. "Enviar" chama `window.__scribeApi.atendimentoDraftSend({ chatId, text })` **direto no `onClick`**, com o texto como está no campo; desabilitado com texto vazio ou envio em curso. Com `ok: true`, a caixa some e a conversa é relida como no envio normal. Erros: `click` → "Clique em Enviar de novo."; `state` → "O WhatsApp não está conectado."; `no-draft` → "Essa proposta não existe mais."; demais → "Não foi possível enviar." (a caixa permanece, salvo `no-draft`).
- CA28. "Descartar" chama `discardDraft(chatId)` e a caixa some. Uma proposta nova (evento `scribe:atendimento-changed`) substitui o texto mostrado, mesmo editado.
- CA29. O campo de mensagem, "Rascunho com o Claude" e o "Enviar" normal continuam funcionando com a caixa aberta.

### Mensagens do agente
- CA30. Ao abrir uma conversa com atendimento, o histórico dela é lido (`loadLog` não pode estragar o filtro da aba: use uma leitura própria com `chatId`). Mensagens `fromMe` cujo id está em `agentMessageIds` mostram o ícone `Bot` e o nome do agente junto da hora ("Recados · 14:05"); as demais não mudam.

### Geral
- CA31. `useAtendimento.load()` é chamado ao montar a tela do WhatsApp. Sem atendimento nenhum e sem agentes, a tela fica idêntica à de hoje, salvo o botão "Atendimento" no cabeçalho de conversa individual.
- CA32. Design: só componentes de `src/renderer/src/design/`, cores por variável, nenhum modal, ícones `lucide-react` de 16 px, textos em pt-BR sem jargão; claro e escuro sem código próprio por tema.

## Invariantes
- Seletores e comportamentos que o smoke atual usa continuam valendo: `[data-whatsapp-chat]`, `[data-whatsapp-chats]`, `data-whatsapp-chat-title`, `toggle-whatsapp-details` com `aria-pressed`, `[data-wa-details]`, `#whatsapp-composer`, `whatsapp-send`, `whatsapp-draft`, `[data-whatsapp-draft-panel]`. O smoke existente passa sem mudar checks nem a contagem de prints.
- O envio normal (`sendNow`, `whatsappSend`) e o rascunho do Claude não mudam.
- Nenhum arquivo de `src/main` muda, fora a mudança de lugar de `isWithinHours`. Nenhum canal novo, nenhum método novo no preload.
- O renderer não importa nada de `src/main` nem `shared/atendimento-schema.ts`.
- A aba Atendimento das Automações (contrato 142) não muda, salvo receber o filtro do "Ver histórico".

## Fora de escopo
- Checks e prints novos no smoke, README e guia do app (contrato 144).
- Atendimento em grupos; controle pela bandeja; abrir o painel pelo Assistente.

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`, da raiz (8 passos, cerca de 20 minutos; exige a tela do Mac
acesa e desbloqueada). Se o smoke parar por tela bloqueada ("display surface not available"), relate isso com
os passos que passaram, sem tentar contornar. Testes novos: CA1 a CA10.

## Relatório final
Arquivos criados e alterados; resultado de cada passo dos gates com contagens; o que ficou diferente do mockup
e por quê; critérios não cumpridos ou adaptados. Não commitar.
