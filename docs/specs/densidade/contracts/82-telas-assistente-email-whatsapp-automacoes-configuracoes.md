# Contrato 82 — Telas densas: Assistente, Email, WhatsApp, Automações, Configurações

Feature `densidade` · Wave 2 · Depende de: 79 e 80 commitados · Spec `../spec.md` (seção "Telas", CA2, CA3). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-densidade`. Paralelo com o 81: **fronteira** = `features/chat/**` (exceto `ChatHistory.tsx`, que é da barra/79), `features/email/**` (exceto `EmailNav.tsx`), `features/whatsapp/**`, `features/agents/**`, `features/schedules/**`, `features/settings/**`, e os checks do smoke dessas telas (`assistant*` de tela, `email*`, `whatsapp*`, `automations*`/`tasks*`, `settings*` de tela incluindo o título `'20px/26px'` → `'15px/20px'` e `modelRowHeight` 40); blocos `// 82: densidade` no `smoke.ts`.

Atenção: a branch `assistente-agenda` (contrato 78) remove o `PageHeader` do `ChatScreen.tsx` e mexe em `ActionCards.tsx`/`chatStore.ts`. Para a junção ser limpa: no `ChatScreen.tsx` mude só paddings/alturas (não remova o PageHeader aqui; o 78 remove); em `ActionCards.tsx` não mexa (os cartões herdam `Button` 32 do 80; se algum padding de cartão precisar, anote no relatório).

## Medidas por tela
- **Assistente** (`ChatScreen.tsx`, `ChatConversation.tsx`, `ChatMessages.tsx`, `ContextPanel.tsx`, `SourcesSection.tsx`, `ConnectionsContext.tsx`): página `px-8 pt-5 pb-5`; cabeçalho da conversa `h-11` (44) `px-5`, título 15/700; sugestões `min-h-11 px-3 py-2` 13; corpo `px-6 pb-5`, coluna 720 `gap-4 pt-4`; caixa de pergunta `px-6 py-3`, textarea `min-h-11` 14, seletores 28; balão da pessoa `px-3 py-2` 14/22; cartão de resposta `px-3 py-2.5`, texto 14/22; Contexto largura 300 mantida, cabeçalho `h-10` (40) 13/700, seções `px-3 py-3`, rótulo `.label`, linhas `h-7` 13.
- **Email** (`EmailScreen.tsx`, `ReadingPane.tsx`, `Composer.tsx`, `OrganizePanel.tsx`; lista 340 mantida): topo da lista `px-2 pt-2 pb-1`, título 15/700, barra de seleção `h-8`; linha `px-2 py-1.5 gap-2.5`, remetente 13/600, assunto 13, prévia 12, caixa de seleção `size-8`; leitura barra `h-11 px-5`, corpo `px-5 py-4` 760, assunto 17/600, corpo 15/24 mantido, rótulos `.label` (o `ReadingPane:107` sai de `.caps`); compor cabeçalho `min-h-11 px-5`, campos 32, texto 15 `min-h-[140px]`; organizar `px-5 py-4`, título 15/700.
- **WhatsApp** (`WhatsAppScreen.tsx`, `Avatar.tsx`, `DetailsPanel.tsx`): busca `h-7`; linha `px-2 py-1.5 gap-2.5`, avatar 32, nome 13, prévia 12; cabeçalho `h-11 px-5` 15/700; mensagens `px-5 py-3`; balões `px-3 py-1.5` 14/22 máx. 560; composição `px-4 py-3`, campo 32; detalhes cabeçalho `h-10`, seções `px-3 py-3`, rótulos `.label`.
- **Automações** (`AutomationsScreen.tsx`, `AgentsTab.tsx`, `SchedulesTab.tsx`, `RunsTab.tsx`, `AgentForm.tsx`, `TaskForm.tsx`): cabeçalho `px-8 pt-5`, abas `mt-4` (32), corpo `pt-4 pb-8`; cartão de agente `p-3 gap-2`, título 13/600, grade 300/gap 12; tarefas: cabeçalho `.label` `py-1.5`, linha `py-1.5` 13, botões 28; execuções `py-1.5`; formulários título 15/700, gap 16, campos 32.
- **Configurações** (`SettingsScreen.tsx`, `ModelPicker.tsx`, `ConnectionsSection.tsx`, `PluginsSection.tsx`, `AccountsSection.tsx`, `EmailRulesSection.tsx`, `EmailFoldersSection.tsx`, `AboutSection.tsx`, `CalendarSection.tsx:80` e `WhatsAppSection.tsx:90` tiram caps/tracking; grupos da busca `SettingsScreen:506` usam `.label`): topo `px-8 pt-5 pb-2`, título 15/700 (PageHeader `section` do 80), busca 32 `-my-0.5`; rolagem `pt-5 pb-8`, seções `gap-6`; seletor de modelo busca `h-8`, linha `min-h-10 px-2.5 py-1.5`; Conexões blocos `py-3`, linhas `px-2 py-1.5` mono 12; Plugins/Contas `py-3`; regras `py-2`, botões 28; pastas `min-h-8 py-1`; Sobre 13.

## Smoke
Expectativas: título de Configurações `'15px/20px'` 700; `modelRowHeight` entre 40 e 48; trilho do Assistente largura 300 e cabeçalho 40; `contentLeft` 32 / `contentTop` 20 nas suas telas; linhas de email/whatsapp se medidas. Prints regravam; `expectedShots` igual. Audite os prints das suas telas (claro e escuro).

## Critérios de aceite
Medidas no DOM; nenhum `.caps` restante nas suas telas; tokens; prints auditados.

## Fora de escopo
81, 79, 80, 83; remover o PageHeader do Assistente (78).

## Gates / Relatório
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Relatório curto: arquivos; gates; auditoria dos prints; diferenças e por quê; pontos de possível conflito com a branch assistente-agenda (liste as linhas de `ChatScreen.tsx` que você tocou).

## Adendo: achados do contrato 80 nas suas telas (corrigir aqui)
- Configurações: busca ainda 40 (`SettingsScreen.tsx:~275`, comentário "campo 40 ocupa 32" desatualizado) → 32 com `-my-0.5`; topo `px-10 pt-7` e rolagem `pt-8` → `px-8 pt-5` / `pt-5`; `modelRowHeight` 56 → 40.
- Configurações › Email (regras, `EmailRulesSection.tsx`): selects/campos com `h-9`/`h-10` concorrendo com o `h-8` do `CONTROL_CLASS` (saem 36) → remova as alturas locais e deixe o componente mandar; segmentado "todas/qualquer uma" e "Executar agora" na mesma altura (28/32).
- Email compor: botão de anexo com ícone `h-10` → 32, alinhado a "Descartar"/"Enviar".
- WhatsApp: vários `h-10` em `WhatsAppScreen.tsx` (anexo, campo, botões) → 32; cabeçalho 56 → 44.
- Automações: título com `px-10` → `px-8`; **formulário de tarefa, campo "Nome" com centenas de px de altura** (`flex-[1_1_280px]` do `TextField` dentro de `FormField` em coluna vira altura; defeito já existe na 0.17.1): corrija no `FormField`/uso (ex.: `flex-none w-full` no campo quando em coluna), sem mexer no `design/Field.tsx` do 80 a não ser que seja a única saída (aí avise).
- Cabeçalhos de painel ainda 48/56: `ChatConversation.tsx`, `ContextPanel.tsx`, `DetailsPanel.tsx` → 44/40 como na tabela.
- `.caps` restantes nas suas telas: `CalendarPicker.tsx`, `OrganizePanel.tsx`, `ReadingPane.tsx`, `CalendarSection.tsx`, `SettingsScreen.tsx` → `.label`.
- design.md: parágrafos de tela das suas telas (Assistente, Email, WhatsApp, Automações, Configurações) que citem 40/56/48/20 px → valores densos; mantenha a seção de tipografia e "Controles e densidade" do 80 como estão.
