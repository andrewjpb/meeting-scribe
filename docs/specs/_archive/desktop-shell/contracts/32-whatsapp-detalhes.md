# Contrato 32 — WhatsApp em 3 colunas com Detalhes por IA
Feature: desktop-shell · Wave: 32 · Depende de: 15 (WhatsApp), 17 (ACP), 23 (notas) · PRD: `docs/specs/desktop-shell/prd-whatsapp-detalhes.md`

## Pré-condições (fatos do código, conferidos em 18/11/2026; caminhos relativos a apps/desktop salvo services/)
- Tela atual: `features/whatsapp/WhatsAppScreen.tsx` (2 colunas: aside w-[280px] + Conversation, :368-450), `ChatRow` SEM avatar (:31-60), `MessageItem` com balões `bg-bg-sunken` (meu) / `border bg-bg-raised` (dele), mídia só como `Paperclip + mediaLabel` (:63-81); envio = clickToken no preload (:36-40) → send-guard (uso único 10s) → diálogo nativo `confirmWhatsAppSend` (`index.ts:1095-1110`); store `whatsappStore.ts` (paginação 50, `receiveMany` 250ms, `useWhatsAppSync`).
- Dados: `WhatsAppMessage {id,chatId,author,fromMe,at,type,text,media?}` (`src/shared/whatsapp.ts:66`), `WhatsAppChat {id,name,kind,unread,lastMessage,phone?}` (:78); **não existe foto em lugar nenhum** (tabelas em `services/whatsapp-bridge/bridge_store.py:46-65`); rotas do bridge em `server.py:181-283`; backend real `backend_neonize.py` (o neonize/whatsmeow TEM como buscar foto de perfil); falso `backend_fake.py` (SEED_CHATS Ana/Atlas/Bruno, controles `/_fake/*`). CSP: `img-src` em `src/main/security.ts:73,89` (data: — conferir; as fotos de conta Google/MS já são data URL exibidas via `<img>`, `AccountsSection.tsx:89`, `photoToDataUrl` `index.ts:1020`, limite 2 MB).
- IPC WhatsApp: invokes em `ipc.ts:264-290`, eventos :333-374, WHEN_LOCKED 'refused' :736+. Canal novo segue o padrão (InvokeChannels + INVOKE + WHEN_LOCKED + lock-ipc.test).
- Claude one-shot: `runClaudeOneShot` (`claude-one-shot.ts:43`), purposes `'summary'|'analysis'|'draft'|'ai-notes'` (:31) — purpose novo exige estender também `AcpPurpose` (`acp/profiles/types.ts:10`) e `purposeOf` do agente falso (`test/fixtures/fake-acp-agent.mjs:165-173`, identifica pelo começo do system prompt); blindagem padrão `taggedBlock`/`escapeTurnText` (`summary.ts:128`, `prompt.ts`), parser `extractJsonObject` (:160), modelo de schema com custo: `meeting-analysis-schema.ts:23-40`; IA existente no WhatsApp: só o rascunho (`src/main/whatsapp/draft.ts`, `messageLine` de `export.ts`, linhas `[dd/mm hh:mm] Autor: texto`).
- 3 colunas prontas no Assistente: `ChatScreen.tsx:50` (aside 248px some <1280px com contexto aberto, `max-[1279px]:hidden`), painel direito `ContextPanel.tsx:159` (`aside w-[280px] border-l`, cabeçalho h-12 + X, `PanelSection` :27), botão com `aria-pressed` (`ChatConversation.tsx:296`).
- Gráficos: NENHUMA lib; padrão leve = SVG estático com `<rect>` e classes de token (`design/TapeIllustration.tsx`), canvas 2D no `LevelTape.tsx` (cores via `readColors` das variáveis CSS). Sem sombra/pílula/raio>6px (gates 6 e 7); `rounded-full` é proibido — avatar usa `rounded-[var(--radius-control)]` como as fotos de conta.
- Rodapé de custo: `costLabel`/`COST_HINT` (`features/chat/format.ts:35-41`), exemplo `analysisFooterParts` (`AnalysisBlock.tsx:43-46`).
- Testes/smoke: `test/whatsapp.test.ts` (509 linhas; ":341 nenhum caminho fora do clique"), `whatsappChecks` (`smoke.ts:4991`, checks detect/install/risk/paired/screen/draft/send/ask/dark), `whatsappLockCheck` :5282, fixtures `smoke-fixtures.ts:182-183`, `WA_ANA` :4970, python `services/whatsapp-bridge/tests/`.
- Settings: padrão 4 lugares + `settingsIndex`; aba claude.

## Critérios de aceite

### CA1 — Foto de perfil (bridge + app)
- Bridge: rota nova `GET /chats/<id>/photo` → `{photo: <data URL jpeg/png>|null}`; no backend real via neonize (foto de perfil do contato/grupo; falha ou sem foto → null; cache em disco na pasta do bridge com validade de 7 dias; ≤512 KB — maior, reduzir ou devolver null); no falso, fotos determinísticas pequenas para Ana e Atlas, Bruno sem (para o fallback aparecer). Testes python das duas pontas.
- App: canal `scribe:whatsapp-photo {chatId}` → `string|null` ('refused' bloqueado), com cache em memória no main; renderer pede uma vez por chat visível (lista e cabeçalho) e NUNCA bloqueia a UI. CSP intocado se data URL já passa (conferir; senão ajustar `img-src` SÓ para data:).
- Avatar: componente novo `Avatar` (`size-8`/`size-10`, `rounded-[var(--radius-control)]`, `object-cover`); sem foto → iniciais do nome (1-2 letras) sobre fundo das cores `--note-*` escolhidas de forma determinística pelo id; grupo sem foto → ícone `Users`. Dark ok.

### CA2 — Visual em 3 colunas (design LAP, tokens; NADA de cor hardcoded, sombra ou pílula)
- Lista (aside ~300px): `Avatar` + nome + hora (`messageTimeLabel`) + prévia + selo de não lidas `bg-accent` (como hoje); busca permanece. Grupo mostra o Avatar de grupo.
- Conversa: cabeçalho com Avatar + nome + (pessoa: telefone / grupo: "grupo"); balões redesenhados — os seus: `bg-accent` com texto claro, à direita; os deles: `bg-bg-raised border border-line`, com autor em grupos; hora discreta no balão; mídia continua metadado mas com chip melhor (ícone por tipo: imagem/vídeo/áudio/documento + nome + tamanho). Agrupar mensagens seguidas do mesmo autor (Avatar só na primeira). Entrada/envio/draft NÃO mudam de comportamento.
- Painel direito "Detalhes" (`aside w-[300px] border-l`, padrão ContextPanel, botão X, toggle no cabeçalho da conversa com `aria-pressed`, aberto por padrão; <1280px vira sobreposição ou esconde a lista como no Assistente). Marcar `data-wa-details`.

### CA3 — Detalhes por IA (purpose novo `whatsapp-insights`)
- Ao abrir uma conversa (e painel aberto): se não há análise em cache para o `lastMessage.at` atual, roda sozinho; senão mostra o cache com "Atualizar". Botão "Analisar" manual sempre disponível. Enquanto roda: indicador discreto. Falha: aviso curto + "Tentar de novo". Interruptor `whatsappInsights` (padrão **true**, 4 lugares + settingsIndex, seção Claude: "Detalhes com IA no WhatsApp"); desligado → painel mostra só os gráficos locais e um botão para ligar.
- Entrada da IA: últimas ≤200 mensagens via `messageLine` (como o draft), `taggedBlock`/escape; system prompt no padrão da análise (material-não-instrução, só JSON). Saída zod estrita (schema em `src/shared/` sem zod no renderer, com `model/costUsd/durationMs`): `{resumo (≤600), pontos: string[] (≤8×200), humor: {valor:'positivo'|'neutro'|'negativo', justificativa (≤300)}, humorDias: [{dia:'AAAA-MM-DD', valor}] (≤14), pendencias: {minhas: string[] (≤5×200), deles: string[] (≤5×200)}, compromissos: [{texto (≤200), quando?: string (≤40)}] (≤8)}`. Parser tolerante + limites cortados. Purpose novo estendido nos 3 pontos (claude-one-shot, AcpPurpose, purposeOf do fake).
- Serviço no main no padrão do analysis-service (1 job por chat, dedupe, abort ao trocar de conversa/dispose); cache persistido em `userData/whatsapp/insights.json` (`{chatId: {at, result}}`, escrita atômica, zod na leitura, arquivo corrompido descartado sem quebrar). A IA NUNCA envia mensagem; nenhum caminho novo de envio (o teste ":341" continua valendo).
- Painel: Resumo; Pontos importantes; **Humor** (rótulo Satisfeito/Neutro/Insatisfeito + justificativa + nota fixa "leitura aproximada do texto"); Pendências (Minhas · Deles); Compromissos; rodapé modelo · tempo · custo (`costLabel`).

### CA4 — Gráficos locais (sem IA, sem lib)
- Calculados das mensagens carregadas: **Atividade** (mensagens por dia, últimos 14 dias, barras SVG `<rect>` com classes de token, eixo mínimo, `aria-label` com resumo em texto); **Quem fala** (barra dupla você × eles com percentuais); **Humor no tempo** (linha/pontos dos `humorDias` da IA quando existirem). Componente(s) em `features/whatsapp/`, determinísticos e testáveis como função pura (dados → specs das barras). Dark ok; `prefers-reduced-motion` sem animação.

### CA5 — Segurança e invariantes
- Envio inalterado (clique + diálogo + token). IA só lê; saída é dado (zod). Nada de rede nova além da rota local do bridge (127.0.0.1, como as demais). `prova/` não muda. Contratos 01–31 continuam passando. Nenhuma dependência nova.

### CA6 — Testes e smoke
- Vitest: schema/parser dos insights (limites, JSON sujo); cache (hit por `at`, invalidação, arquivo corrompido); funções puras dos gráficos (atividade, equilíbrio, humorDias); Avatar (iniciais, cor determinística); purpose novo no lock-ipc e no fake ACP. Python: rota da foto (real mockado e fake).
- Smoke: seed do fake ganha fotos (Ana, Atlas) e mais mensagens espalhadas em dias; `whatsappChecks` ganha `details` — abre a Ana, espera o painel: resumo do fake presente, humor visível, gráfico `[data-wa-chart]` com barras, foto da Ana na lista e iniciais no Bruno; rodapé com custo; shot novo `whatsapp-detalhes` claro + conferir no dark existente. O fake-acp responde `whatsapp-insights` deterministicamente.

## Fora de escopo
- Baixar/exibir mídia das mensagens; transcrição de áudio; reações; envio de mídia; busca melhorada; foto em grupos sem foto; análise contínua em segundo plano (só ao abrir/clicar).

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde (inclui pytest do bridge).

## Telas de impacto no usuário
- WhatsApp: visual novo em 3 colunas, fotos, painel Detalhes com IA e gráficos.
- Configurações › Claude: interruptor "Detalhes com IA no WhatsApp".

## Notas do coordenador
- Implementar SÓ depois do contrato 31 fechar (serializar; memória apertada). Antes dos gráficos, invocar a skill `dataviz` (ferramenta Skill) e aplicar o que for compatível com os tokens do app — os tokens e os gates de forma/cor têm precedência em conflito.
