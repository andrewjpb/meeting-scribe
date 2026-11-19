# Contrato 35 — Correção automática ao enviar no WhatsApp
Feature: desktop-shell · Wave: 35 · Depende de: 32/33 · Pedido do Andrew (18/11/2026 15:40: corrigir ortografia/pontuação/clareza pela IA e enviar direto, sem confirmação; ligado/desligado em Configurações; "use a versão mais rápida")

## Pré-condições (árvore na main, 395178f)
- Envio: renderer `sendNow` → preload clickToken → main `service.send(senderId, request)` (`src/main/whatsapp/service.ts` — valida zod, consome o token no send-guard gerando a `SendProof`, acha a conversa, `client.send(proof, chatId, text)`); sem diálogo (contrato 33). Teste "nenhum caminho fora do clique" em `test/whatsapp.test.ts` (~:341).
- One-shot Claude: `runClaudeOneShot` (`src/main/meetings/claude-one-shot.ts:43`), purposes atuais `'summary'|'analysis'|'draft'|'ai-notes'|'whatsapp-insights'` — purpose novo exige os 3 pontos (claude-one-shot, `AcpPurpose` em `acp/profiles/types.ts`, `purposeOf` em `test/fixtures/fake-acp-agent.mjs`); `fake-claude.mjs` idem; o one-shot aceita o modelo vindo das Configurações — este contrato FORÇA haiku, independente de `claudeModel`.
- Rascunho (modelo de prompt WhatsApp): `src/main/whatsapp/draft.ts` (blindagem `taggedBlock`/`escapeTurnText`).
- Settings: padrão 4 lugares + `settingsIndex`; interruptores de IA do WhatsApp vivem na aba `claude`, seção "Chat e resumo" (`whatsappInsights` do 32).
- Smoke: `whatsappChecks` (`src/main/smoke.ts`), check `send` reescrito no 33 (clique envia direto; recusas sem clique).

## Critérios de aceite
### CA1 — Configuração
- `AppSettings.whatsappAutoCorrect: boolean`, padrão **false**, nos 4 lugares + linha no `settingsIndex`. Switch na aba Claude, junto de "Detalhes com IA no WhatsApp": **"Corrigir ao enviar no WhatsApp"**, descrição: "Ao clicar em Enviar, o Claude (Haiku) corrige ortografia e pontuação e melhora a clareza da mensagem, e o texto corrigido é enviado sem nova confirmação. Se a correção falhar, a mensagem original é enviada." Marcar `data-setting-row` como as vizinhas.

### CA2 — Correção no fluxo do envio (main)
- Com o interruptor ligado, dentro de `service.send`, DEPOIS de consumir o token (a `SendProof` já na mão) e antes do `client.send`: one-shot purpose novo `'whatsapp-correct'`, SEMPRE modelo haiku (ignora `claudeModel`), timeout próprio curto (`CORRECT_TIMEOUT_MS = 12_000`). Prompt (padrão do draft): system curto — corrigir ortografia, acentuação e pontuação e deixar mais claro SEM mudar o sentido, mesma língua, manter emojis e gírias intencionais ("kkk", abreviações conhecidas podem ficar), NÃO acrescentar nem responder nada, devolver SÓ o texto corrigido; a mensagem entra como material escapado (`taggedBlock('mensagem', …)`).
- Validação da resposta: texto não vazio após trim, ≤ 2× o tamanho do original e ≤ limite do envio; sem cercas/sem tags (limpar cercas ``` se vierem). Resposta inválida, erro, timeout ou interruptor desligado → envia o TEXTO ORIGINAL. O clique NUNCA é perdido: a prova vale durante a correção (ela já foi consumida; nada de segundo token).
- Log no main quando a correção alterou o texto (`[whatsapp] mensagem corrigida antes do envio`) e quando caiu no original por falha. Custo registrado no log (modelo/costUsd/durationMs). A correção NÃO cria caminho novo de envio: o módulo de correção recebe texto e devolve texto (sem client/send-guard importados — o teste ~:341 ganha essa checagem).

### CA3 — Renderer
- Nenhuma mudança de fluxo: clique em Enviar como hoje. Enquanto o envio corrige, o botão fica no estado de enviando já existente (se houver; não criar spinner novo). O balão que aparece é o texto CORRIGIDO (vem do eco do bridge, como qualquer envio).

### CA4 — Testes e smoke
- Vitest: ligado → o texto que chega ao `client.send` é o corrigido (fake); desligado → original intocado e NENHUMA chamada ao Claude; falha/timeout/resposta vazia/resposta gigante → original enviado; purpose novo nos 3 pontos + fake-claude; haiku forçado mesmo com `claudeModel='sonnet'`; `lock-ipc` não muda (nenhum canal novo — tudo dentro do send). Teste ~:341 reforçado (módulo de correção sem acesso a envio).
- Smoke: fixture determinística de correção; no `whatsappChecks`, com o interruptor ligado via settings, enviar "oi tudo bem" → o POST ao bridge contém o texto corrigido da fixture; com interruptor desligado (padrão), o envio existente continua igual. Linha nova conferida no índice de settings (o smoke já cobra).

## Fora de escopo
- Corrigir rascunhos do Claude (já nascem revisados); pré-visualizar a correção antes de enviar; escolher o modelo; corrigir mensagens recebidas.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Configurações › Claude: interruptor "Corrigir ao enviar no WhatsApp".
- WhatsApp: com o interruptor ligado, a mensagem enviada sai corrigida.
