# Contrato 146 — Início: botão "Atualizar", "Atualizado às", linha de não lidos, smoke e documentação

Feature: inicio-atualizar  ·  Wave: 2  ·  Depende de: 145

Constituição: `CLAUDE.md` do usuário e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Contrato 145 aceito e commitado (`emailsNaoLidos`, `atualizadoEm`, `scribe:inicio-atualizar`).
- Desenho aprovado pelo Andrew em 23/11/2026: `docs/specs/inicio-atualizar/mockups/png/01-inicio-atualizar-claro.png`, `-escuro.png`, `02-atualizando-claro.png`, `03-falha-parcial-claro.png` (fonte `mockups/InicioAtualizar.html`). Em dúvida de aparência vale o mockup; de texto, este contrato.

## Contexto mínimo
Tela em `apps/desktop/src/renderer/src/features/inicio/` (`InicioScreen.tsx`, `inicioStore.ts`,
`CartaoPendencias.tsx`, `inicioFormat.ts`). O cabeçalho é um `<header className="flex items-end justify-between">`
com a saudação e a data. Precedente do botão: "Atualizar" de Redes (`features/redes/CommentsSection.tsx`:
`Button variant="secondary" icon={RefreshCw}`, rótulo "Atualizando…" enquanto roda). O smoke do Início tem os
checks `inicio…` em `main/smoke.ts`, entre eles um que exige todo controle alcançável por teclado e habilitado.

## Superfície
- Alterar `features/inicio/InicioScreen.tsx`, `inicioStore.ts`, `CartaoPendencias.tsx`, `inicioFormat.ts`.
- Alterar `apps/desktop/src/main/smoke.ts` (e `smoke-fixtures.ts` se preciso).
- Alterar `apps/desktop/resources/assistente/guia-do-app.md` (seção do Início) e `docs/specs/desktop-shell/design.md` (seção Início).
- Testes: `test/renderer/inicio-format.test.ts` e um teste do store (`test/renderer/inicio-store.test.ts`, novo ou existente).

## Critérios de aceite
### Store e formato (testes)
- CA1. `atualizar()` do store chama `scribe:inicio-atualizar`, liga `atualizando` até a resposta, troca a view e guarda `falhou`; chamado com `atualizando` ligado, não faz outro pedido. Rejeição do canal: `atualizando` volta a `false`, `falhou` fica `true`, a view anterior permanece.
- CA2. Uma view nova bem-sucedida (por `load`, por evento ou por `atualizar` sem falha) limpa `falhou`.
- CA3. `textoAtualizado(iso)` → "Atualizado às 14:32" (hora local, 24 h). Texto de não lidos: 1 → "1 email não lido"; 5 → "5 emails não lidos". A linha que já existe passa de "e-mails pendentes" para "N email(s) na pasta Pendentes" (singular "1 email na pasta Pendentes").
### Tela
- CA4. No cabeçalho, à direita: texto `[data-inicio-atualizado]` (12 px, `--text-muted`, números tabulares) e, 12 px depois, `Button variant="secondary" icon={RefreshCw} action="inicio-atualizar"` com "Atualizar". A base do botão alinha com a linha da data; a borda direita, com a dos cartões.
- CA5. Durante a leitura: rótulo "Atualizando…", botão desabilitado, e o texto ao lado continua mostrando a hora da última leitura. O ícone não gira.
- CA6. Com `falhou`: no lugar de "Atualizado às…", "Não foi possível atualizar tudo." em `--rec`, com `role="status"`; some na próxima leitura bem-sucedida.
- CA7. Antes da primeira view, o texto não aparece e o botão já funciona.
- CA8. No cartão de pendências, última linha: ícone `Inbox`, "N emails não lidos" (`data-inicio-nao-lidos`), no padrão das outras linhas, levando à tela Email; com zero, não existe. Se a única pendência for essa, o cartão aparece.
- CA9. Chegando `scribe:inicio-changed`, a hora de "Atualizado às" acompanha o `atualizadoEm` da view recebida.
### Smoke
- CA10. Checks novos do Início: (a) o botão existe, é alcançável por teclado e, clicado, o texto `[data-inicio-atualizado]` passa a existir/mudar e o botão volta a habilitar; (b) com um email não lido injetado pelo mecanismo de email falso que o smoke já usa, a linha "1 email não lido" aparece sem clique em até 5 s. Se o smoke não tiver como injetar email não lido sem rede, relate e cubra (b) pelo estado inicial das fixtures.
- CA11. Todos os checks atuais do Início continuam passando, inclusive o do estado vazio (nenhuma pendência com as fontes vazias) e o do teclado. Nenhum print novo; a contagem `expectedShots` não muda. Abra os prints `inicio-dia-light`, `inicio-dia-dark` e `inicio-vazio-light` gerados e confira o topo novo (sem sobreposição, tema certo).
### Documentação
- CA12. Guia do app, seção do Início: descreve o botão "Atualizar", "Atualizado às", a linha de emails não lidos e que a tela se atualiza sozinha quando chega email e ao desbloquear; a frase sobre o app bloqueado continua verdadeira. `design.md`, seção Início: registra a ação no topo e mantém "só leitura". Marcadores `<!-- tela: … -->` intactos.
- CA13. Design: só componentes de `design/`, cores por variável, sem sombra, textos pt-BR.

## Invariantes
- Nenhum arquivo de `src/main` muda, fora `smoke.ts`/`smoke-fixtures.ts`. Nenhum canal novo.
- Os demais blocos do Início (agenda, tarefas, última reunião, automações, faixa de gravação) não mudam.

## Fora de escopo
- IA, triagem, prévia de email, intervalo configurável, tela Email.

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`, da raiz (cerca de 20 min, tela do Mac desbloqueada). Tela bloqueada: relate sem contornar.

## Relatório final
Arquivos alterados; resultado de cada passo dos gates com contagens; o que se vê nos três prints abertos; diferenças do mockup; critérios adaptados. Não commitar.
