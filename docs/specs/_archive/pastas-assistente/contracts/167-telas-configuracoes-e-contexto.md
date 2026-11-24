# Contrato 167 — Pastas do Assistente: seção em Configurações › Claude e linha Pastas no painel Contexto

Feature: pastas-assistente  ·  Wave: 2  ·  Depende de: 165  ·  Gate humano: mockups 01–03 aprovados pelo Andrew

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Worktree `~/Documents/GitHub/meeting-scribe-pastas-assistente`, branch `pastas-assistente`, 165 commitado (canais `scribe:assistant-folder-add`/`-remove`, `settings.assistant.folders`, fonte `pastas`). Gates rápidos verdes.
- O contrato 166 roda **em paralelo** na mesma árvore (main, `shared/chat.ts`, `shared/ipc.ts`, `main/index.ts`, `ChatMarkdown.tsx`): **não tocar** nenhum desses. Este contrato é só renderer: `SettingsScreen.tsx`, `SourcesSection.tsx`, hooks/stores do renderer que eles já usam, `shared/settings-index.ts` (só texto, se faltar).
- Desenho de referência: `docs/specs/_archive/pastas-assistente/mockups/png/01-configuracoes-pastas.png`, `02-configuracoes-recusa.png`, `03-contexto-pastas.png` (e `03b` se existir), com o HTML em `mockups/PastasAssistente.html`. Seguir o desenho; dúvida de pixel resolve-se pelo `design.md` e pelos componentes existentes (`SettingRow`, `Switch`, `Section`, botões secundários).

## Contexto mínimo
A lista de pastas é gravada só pelo main (165). A tela só mostra `settings.assistant.folders`, chama os dois canais e exibe o resultado. No painel Contexto, a fonte `pastas` ganha a linha com interruptor por conversa; com a lista vazia, a linha fica desabilitada e aponta para Configurações.

## Superfície
- Alterar `renderer/src/features/settings/SettingsScreen.tsx` (`panel('claude')`, logo depois da `Section` "Chat e resumo"): `Section` **"Pastas que o Assistente pode ler"** com:
  - texto de ajuda: "O Assistente só lê; nunca altera, move ou apaga. Pastas ocultas, a pasta pessoal inteira e as do sistema não podem ser escolhidas.";
  - lista: uma linha por pasta (ícone de pasta, nome = último segmento, caminho encurtado com `~`, botão **Remover**); vazia → "Nenhuma pasta escolhida";
  - botão **Adicionar pasta…** (secundário) → `invoke('scribe:assistant-folder-add')`; enquanto espera, desabilitado;
  - resultado: pastas adicionadas aparecem (o settings store do renderer é atualizado pelo evento de settings existente; se não houver evento, refazer `get`); `refused` vira aviso em linha (tom de atenção, mesmo componente de aviso usado em outras seções), um por motivo, textos fixos: `sensivel` → "Pasta pessoal, Library ou do sistema não pode ser escolhida (muito ampla). Escolha uma pasta dentro dela."; `oculta` → "Pastas ocultas não podem ser escolhidas."; `repetida` → "Essa pasta já está na lista ou dentro de uma pasta da lista."; `inexistente` → "Pasta não encontrada."; `limite` → "No máximo 20 pastas."; `replaced` não vazio → "Pastas dentro dela foram substituídas: N." O aviso some ao adicionar com sucesso ou ao sair da aba;
  - **Remover** → `invoke('scribe:assistant-folder-remove', {id})` e a linha sai.
  - A contagem "N arquivos legíveis · M só para anexo" do mockup **não** entra neste contrato (precisaria de varredura no clique; fica como pendência no plan) — a linha mostra só nome e caminho.
  - `nameId`/`data-*` para o smoke: `settings-assistant-folders` na Section, `data-assistant-folder-id` em cada linha, `data-assistant-folder-add`, `data-assistant-folder-refused` no aviso.
- Alterar `renderer/src/features/chat/SourcesSection.tsx`: `SOURCE_TEXT.pastas = { name: 'Pastas', description: 'Arquivos das pastas que você escolheu em Configurações; só leitura' }`; `SourceRow` para `pastas` na ordem do mockup; quando `settings.assistant.folders.length === 0`: descrição trocada por "Nenhuma pasta escolhida · Configurações" (com "Configurações" como link/botão que navega para a aba Claude das Configurações, como outros atalhos do app fazem) e interruptor desabilitado (`disabled`, `aria-disabled`); quando há pastas, interruptor normal (padrão desligado vem do 165). A leitura dos settings usa o hook/store de settings já usado no renderer (o mesmo que a tela de Configurações usa); `data-chat-source="pastas"` na linha.
- Testes: se existir teste de renderer para `SourcesSection`/`SettingsScreen` (procurar em `apps/desktop/test/` e `renderer/**/*.test.tsx`), acrescentar os casos; senão, cobrir o que for puro (ex.: função que mapeia `FolderRefusal → texto`, exportada de um módulo pequeno em `features/settings/`) e deixar o resto para o smoke do 169.

## Critérios de aceite
- CA1: Configurações › Claude mostra a Section nova depois de "Chat e resumo" com o texto de ajuda e o botão Adicionar pasta…; lista vazia mostra "Nenhuma pasta escolhida" (mockup 02 sem o aviso).
- CA2: Clique em Adicionar pasta… chama `scribe:assistant-folder-add` uma vez (botão desabilitado durante a espera); resposta com `added` → linhas aparecem com nome e `~/caminho`; resposta com `refused: [{reason:'sensivel'}]` → aviso com o texto fixo (mockup 02); `limite` → "No máximo 20 pastas."
- CA3: Remover chama `scribe:assistant-folder-remove` com o id da linha e a linha sai.
- CA4: Painel Contexto: linha Pastas presente (mockup 03), desligada por padrão; com lista vazia, descrição "Nenhuma pasta escolhida · Configurações", interruptor desabilitado e o atalho leva à aba Claude; com uma pasta, interruptor liga/desliga e persiste por conversa como as outras fontes (`toggle` existente).
- CA5: Nenhum caminho de pasta é mandado pelo renderer ao main (só `id`); o patch geral de settings continua mandando o objeto inteiro (o main ignora `folders`, 165).
- CA6: Tema claro e escuro sem contraste quebrado (conferir pelos tokens, como as seções vizinhas).
- CA7: Textos em pt-BR, sem "pastas permitidas" em inglês, sem nomes reais de pasta em placeholder.

## Invariantes
- Só `SettingsScreen.tsx`, `SourcesSection.tsx`, módulos novos pequenos dentro de `features/settings/` ou `features/chat/` (que o 166 não toca), `settings-index.ts` (texto). `git diff --stat` não mostra `main/`, `shared/ipc.ts`, `shared/chat.ts`, `ChatMarkdown.tsx`.
- Nenhuma gravação de `folders` pelo renderer.

## Fora de escopo desta tarefa
- Contagem de arquivos por pasta na lista (pendência). Cartão e Composer (168). Smoke e docs (169).

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` da raiz do worktree. O gate completo roda ao fim da wave 2 (166 + 167 juntos).

## Relatório esperado do implementador
≤ 30 linhas: arquivos alterados/criados, como leu os settings no `SourcesSection`, se havia teste de renderer e o que cobriu, dúvidas resolvidas sozinho.
