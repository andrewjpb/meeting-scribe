# Contrato 68 — Correções do teste navegado da 0.17.0 (sidebar em pilha)

Origem: teste navegado interno de 2026-11-20 no app instalado 0.17.0 (17 PASSOU / 1 FALHOU). Spec de referência: `docs/specs/_archive/sidebar-pilha/spec.md` (CA15, R-nível Assistente) e contratos 65–67. Este contrato fecha a falha e duas sugestões baratas; nada mais muda. Sem alteração de design visível além do item C.

## A. Esc na busca de Configurações devolve o foco à linha da aba (FALHA, CA15)

**Hoje:** em Configurações, ⌘F, digitar texto, Esc: a busca limpa, mas o foco fica no campo. A spec (CA15) e o contrato 66 pedem que o foco vá para a linha da aba aberta no nível Configurações do sidebar.

**Causa a confirmar antes de corrigir:** `SettingsScreen.tsx` trata Esc num listener global de `window` e só chama `focusTabLink(tab)` quando `event.defaultPrevented && queryRef.current`. A limpeza é feita por OUTRO listener global, o do `SearchField` (`features/meetings/SearchField.tsx`), que chama `preventDefault()` e `onChange('')`. A hipótese é que, quando o listener de `SettingsScreen` roda, a ref já está vazia (o React 19 descarrega o render e o efeito `queryRef.current = query` antes) e/ou a ordem dos dois listeners em `window` não é a esperada (o `SearchField` remonta e passa a registrar depois). Reproduza primeiro pelo smoke (item D) e registre a causa real no relatório.

**Correção pedida (sem depender de ordem de listeners nem de refs):** `SearchField` ganha a prop opcional `onClear?: () => void`, chamada logo depois de `onChange('')` quando o Esc limpou o campo (só nesse caso; não ao apagar com Backspace). `SettingsScreen` passa `onClear={() => focusTabLink(tab)}` e remove o ramo de Esc do seu listener global e o `queryRef` se ficarem sem uso. A tela de Reuniões continua igual (não passa `onClear`).

**Prova:** D1.

## B. Esc e Enter no renomear de conversa devolvem o foco à linha (sugestão, passo 11)

**Hoje:** em `features/chat/ChatHistory.tsx`, no modo `rename`, Esc cancela e Enter salva, mas o foco vai embora da barra lateral (body). 

**Correção (ajustada na revisão: blur não refoca, pois o foco deve ficar onde o usuário o pôs):** ao sair do modo `rename` por Esc ou por Enter, o foco vai para o botão principal da linha da conversa (o elemento clicável que abre a conversa). Use um ref para esse botão e `focus({ preventScroll: true })` depois que a linha voltar ao modo `idle` (efeito ou `queueMicrotask`, como o resto do arquivo já faz para o menu). Esc continua cancelando sem salvar.

**Prova:** D2.

## C. Sinal de rolagem nas listas dos níveis Email e Assistente (sugestão, passos 2 e 18)

**Hoje:** no nível Email a lista de contas/pastas (`[data-email-nav]` em `EmailNav.tsx`) rola, mas quando está cortada no pé (ex.: Lixeira com 8 px à mostra) nada indica que há mais abaixo. O mesmo vale para a lista de conversas do nível Assistente (`[data-chat-list]` em `ChatHistory.tsx`).

**Correção:** um esmaecimento (fade) de 24 px na borda inferior do contêiner rolável, visível só quando `scrollHeight > clientHeight` e a rolagem não chegou ao fim (tolerância de 1 px). Implementar uma vez (hook `useScrollFade` ou componente `ScrollFade` em `design/`) e usar nos dois lugares. Cor: gradiente de transparente para `var(--color-side-bg)` (a cor de fundo da barra lateral que já existe nos tokens; conferir o nome real em `design/base.css`, nunca literal). Sem animação nova; `pointer-events: none`; não altera o layout nem a altura das linhas; o fade não pode cobrir o anel de foco de uma linha focada por teclado (ao focar uma linha escondida, o navegador rola e o fade recalcula). Marcar o elemento com `data-scroll-fade` (presente no DOM só quando visível, ou com `data-visible="true|false"`). Nada muda quando a lista cabe inteira.

**Prova:** D3.

## D. Smoke (`apps/desktop/src/main/smoke.ts`)

- **D1.** No check `settingsSearch`, depois do Esc: `document.activeElement?.dataset.settingsTabLink === '<aba aberta>'` entra na condição `ok` e no `detail` ("foco na linha da aba=..."). ANTES de corrigir A, rode só esse trecho (ou o smoke inteiro) e confirme que a asserção nova FALHA; registre no relatório. Depois da correção, passa.
- **D2.** No trecho de renomear (perto da linha 844): depois de Esc no `[data-chat-rename-input]`, `document.activeElement` é o botão da linha da conversa renomeada (dê a ele um `data-chat-open` ou use o seletor que já exista); idem depois de Enter. Entram em `ok` e `detail` de um check existente ou de um novo `chatRenameFocus`.
- **D3.** No check `emailFits` (contas longas) ou num novo `sidebarScrollFade`: com a janela baixa o bastante para a lista do nível Email não caber, `[data-email-nav] ~ [data-scroll-fade]` (ou a marcação escolhida) está visível; depois de rolar a lista até o fim (`el.scrollTop = el.scrollHeight`), some. Com a lista cabendo inteira, não aparece.
- `expectedShots` não muda, a não ser que você acrescente print; se acrescentar, atualize o número.

## E. Testes de renderer

Se existir teste do `SearchField` ou do `ChatHistory` em `test/renderer/`, acrescente um caso para `onClear` (chamado só no Esc com valor) e um para o foco após Esc no renomear. Se não existir, não crie arquivo novo só para isto; o smoke prova.

## F. Fora do escopo (não tocar)

Título "Nova conversa" desalinhado no chat da reunião; sobra à direita no controle de modelo; prefixo "Agora: data" nas conversas de automação; versão no rodapé (só aparece quando há atualização: comportamento correto); títulos de seção em caps; verde `--live`.

## G. Gates e entrega

`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde na raiz do repo (tela do Mac desbloqueada: o smoke captura janela). Não commitar. Relatório final curto: causa real do item A confirmada pelo D1 falhando antes, arquivos tocados, resultado dos gates (contagem de testes, prints, checks), o que ficou diferente do contrato e por quê.
