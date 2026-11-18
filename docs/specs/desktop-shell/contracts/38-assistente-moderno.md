# Contrato 38 — Assistente moderno (cartões, histórico à direita, contexto embaixo)
Feature: desktop-shell · Wave: 38 · Depende de: 25 (Assistente), 16 (chat v2) · Pedido do Andrew (18/11/2026 16:22, com mockup "Super Chat": "mesmos traços do sistema LAP… ao lado direito histórico de conversas, abaixo… todas as informações do contexto… mais moderno… não fugindo muito")

## Pré-condições (fatos de 18/11/2026; caminhos relativos a apps/desktop/src/renderer/src/features/chat salvo indicação)
- `ChatScreen.tsx`: raiz coluna (:46) + PageHeader (:47-49); linha com aside ESQUERDO `w-[248px]` do histórico (:51 — "Nova conversa" `chat-new`, busca `data-chat-search`, lista `data-chat-list` com `data-chat-day`), conversa à direita (:86-88); `contextOpen` useState(false) local (:30; idem `MeetingChatTab.tsx:21`); `max-[1279px]:hidden` esconde o histórico com o painel aberto (:51). `ChatRow` (:97-218): `data-chat-item`, menu `chat-row-menu` (rename/delete inline, teclado :111-126).
- `ChatConversation.tsx`: o ContextPanel é renderizado DENTRO dele (:460-472, `{contextOpen && <ContextPanel/>}`) — e o componente é COMPARTILHADO com `MeetingChatTab.tsx` (:63), que NÃO muda neste contrato. Cabeçalho `data-chat-header` (:273-303) com `toggle-context` aria-pressed, `chat-scope-label`, `chat-model-label`; rolagem `data-chat-scroll` `max-w-[720px]`; vazio `data-chat-empty` com 6 `data-chat-suggestion`; composer (:378-458: textarea `data-chat-input`, selects `data-chat-model-select`/`data-chat-scope-select` — "reuniões" abre o painel :240-244 —, `chat-think-more`, contador, `chat-send|chat-stop`).
- `ChatMessages.tsx`: user = `li[data-chat-message=user]` `justify-end` bolha `bg-bg-sunken` (o smoke EXIGE `flex-end`, smoke:516); assistant = SEM cartão (:256-295), ordem: AssistantHeader ("Claude · hora") → `Reasoning` recolhível (`toggle-reasoning`, `data-chat-reasoning`, `data-chat-plan/steps/step/denied/thinking`) → `ChatMarkdown` → ActionCards → erro/AgentActions → `AnswerFooter` (`data-chat-footer`, `data-chat-cost`, `toggle-consulted`, `data-chat-web`) → `data-chat-actions` com `chat-copy` (vira "Copiado" 2s) e `chat-redo|chat-retry` só na última; `QUIET_BUTTON` :20; streaming `data-chat-streaming`/`data-chat-status`.
- `ContextPanel.tsx` (`data-chat-context`, X `close-context`): seções Escopo (`data-scope-option` radiogroup + MeetingPicker `data-scope-meeting`), Fontes (`SourcesSection` — só Assistente: `data-chat-source`, `data-chat-whatsapp-mode`, WhatsAppScope), Consultadas (`data-chat-context-consulted`), Totais (`data-chat-totals`), Modelo (Segmented `chat-model`).
- Smoke (src/main/smoke.ts): `chatScreenCheck` :493 (6 sugestões, 3 sections, flex-end), `chatAnswerDetailsCheck` :561, `chatContextCheck` :620-772 (toggle-context→painel aparece; close-context→some; DEPOIS menu do histórico — a ordem atual existe porque a 1120px o histórico some com o painel aberto), `chatStopCheck`, ACP :2386-2450, fontes :5601, internet :5813; PNGs `assistente*`/`perguntar*` (SEM comparação de pixels — fotos só mudam). RISCO: vários checks pegam o PRIMEIRO `aside` do DOM (layoutMetrics :3593, marca :2023…) = a barra lateral do app — ela precisa CONTINUAR sendo o primeiro aside.
- Testes renderer (`test/renderer/chat.test.ts`): nada trava layout. Janela do smoke: 1120×740.

## Critérios de aceite
### CA1 — Trilho direito único (histórico + contexto)
- No ASSISTENTE (ChatScreen; a aba da reunião fica como está): o aside esquerdo some; nasce um trilho DIREITO único (`aside aria-label="Conversas e contexto"`, `w-[300px] border-l`, rolagem própria, renderizado DEPOIS da conversa no DOM — a barra lateral do app continua o primeiro aside). Em cima: "Nova conversa" + busca + a lista de conversas (MESMOS `data-chat-search`, `data-chat-list`, `data-chat-item`, `chat-row-menu` e o menu inline de hoje). Embaixo: a seção **Contexto** da conversa aberta.
- A seção Contexto reaproveita o CONTEÚDO do ContextPanel (Escopo, Fontes quando Assistente, Consultadas, Totais, Modelo) dentro do trilho: recolhida por padrão (só o cabeçalho "Contexto"); `toggle-context`/`chat-scope-label`/`chat-model-label`/escolher "reuniões" EXPANDEM (e rolam até ela), `close-context` recolhe. Expandida, o elemento com `data-chat-context` existe; recolhida, NÃO existe no DOM (o smoke espera aparecer/sumir). `ChatConversation` ganha um jeito de NÃO renderizar o painel interno (prop), usado só pelo Assistente; `MeetingChatTab` continua com o painel interno de hoje, intocado.
- `max-[1279px]:hidden` do histórico morre: com o trilho único, conversa (flex-1) + 300px cabem em 1120; nada some. Sem conversa aberta, o trilho mostra só o histórico (Contexto aparece quando uma conversa é aberta/clicada).

### CA2 — Conversa em cartões (DS da LAP, tokens; sem sombra/pílula; dark ok)
- Resposta do Claude vira um CARTÃO suave: `bg-bg-raised border border-line rounded-[var(--radius-panel)] px-4 py-3`, com a MESMA ordem interna de blocos e TODOS os seletores atuais preservados (reasoning, markdown, footer, ações). As ações (`chat-copy`, `chat-redo|retry`) ficam numa linha no rodapé do cartão, com ícones (Copy, RotateCcw) + rótulo, estilo QUIET_BUTTON refinado; "Copiar" passa a existir em TODA resposta (como hoje) e ganha par no hover mais visível. Mensagem do usuário: continua bolha `bg-bg-sunken` à direita (`justify-end`/flex-end intocado — o smoke mede), com raio do painel e respiro maior.
- Streaming: o cartão nasce com o `data-chat-streaming` como hoje, com um pulso discreto no cabeçalho (CSS, padrão 30b, reduced-motion sem animação).
- Estado vazio: as 6 sugestões viram cartões clicáveis em grade 2×3 (mesmos `data-chat-suggestion`, 3 sections preservadas), mais bonitos (ícone + texto).
- Composer: painel com borda e raio do DS envolvendo o textarea + uma linha de controles embaixo (modelo, escopo, Pensar mais à esquerda; contador + Enviar à direita) — mesmos data-* e comportamentos (↵/⇧↵/↑/Esc, 8 linhas).
- PageHeader "Assistente" permanece (não é o WhatsApp: aqui o título fica).

### CA3 — Invariantes
- NENHUMA mudança de comportamento do motor (ACP, fontes, escopo, modelos, custos); só layout/estilo e a casa nova do contexto. Seletores listados nas pré-condições preservados. `prova/` não muda. Aba de chat da reunião intocada. Contratos 01–37 continuam passando.

### CA4 — Testes e smoke
- Smoke: ajustar `chatContextCheck` ao fluxo novo (abrir expande o Contexto no trilho; fechar recolhe; o menu do histórico funciona COM o contexto expandido — a premissa de esconder morreu; conferir também: trilho à direita da conversa — `getBoundingClientRect` —, histórico acima do Contexto, e Contexto ausente sem conversa aberta). `chatScreenCheck`: grade 2×3 das sugestões. Checks de fontes/internet/ACP: mesmos cliques, só confirmar que seguem passando. PNGs do Assistente mudam — abrir claro e escuro e conferir.
- Vitest: o que for lógica nova extraível (ex.: decisão de expandir/rolar) com teste; os existentes continuam verdes.

## Fora de escopo
- Mudar a aba "Perguntar" da reunião; avatar/foto nas mensagens; regenerar além do Refazer existente; temas novos; mexer no parser de Markdown; parte de plano/preço do mockup.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Assistente: respostas em cartões com ações visíveis, histórico à direita com o Contexto embaixo, sugestões em grade, composer novo.
