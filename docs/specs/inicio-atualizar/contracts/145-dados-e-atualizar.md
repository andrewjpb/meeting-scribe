# Contrato 145 — Início: emails não lidos na view, atualização por email, canal de atualizar e releitura no desbloqueio

Feature: inicio-atualizar  ·  Wave: 1  ·  Depende de: —

Constituição: `CLAUDE.md` do usuário. Prevalece sobre este contrato.

## Pré-condições
- Spec `docs/specs/inicio-atualizar/spec.md` aprovada pelo Andrew em 23/11/2026 ("Aprovo").
- `pnpm typecheck && pnpm lint && pnpm test` verdes. Nenhuma tela muda neste contrato.

## Contexto mínimo
A tela Início lê uma view montada no main (`apps/desktop/src/main/inicio/service.ts`: `view()` e `changed()`),
entregue por `scribe:inicio-get` e pelo evento `scribe:inicio-changed` (`main/inicio/ipc.ts`, tipos em
`shared/inicio.ts` e `shared/ipc.ts`). O serviço não tem relógio: relê quando alguém pede ou quando uma fonte
avisa. O aviso de email novo já chega (`inicioChanged()` em `onMessagesChanged`, `main/index.ts`), mas o único
dado de email da view é o total da pasta Pendentes (`email.pendentesEmCache()`), que não muda com mensagem
nova. `changed()` já junta pedidos concorrentes e só envia quando a assinatura da view muda. A agenda tem
`CalendarService.refresh()`; o dia do Calendário do Mac fica em cache de 5 min dentro do serviço do Início.

## Superfície
- Alterar `apps/desktop/src/shared/inicio.ts`, `shared/ipc.ts`, `main/inicio/service.ts`, `main/inicio/ipc.ts`, `main/index.ts`.
- Alterar `apps/desktop/src/main/email/service.ts` só para expor (a) a contagem de não lidos da caixa de entrada a partir do que já está guardado e (b) uma releitura da lista de pastas; nenhum comportamento existente do email muda.
- Testes: `test/inicio-service.test.ts`, `test/inicio-ipc.test.ts`, `test/email-service.test.ts`, e os testes de listas fixas de canais que o typecheck/suíte apontarem.

### Mudanças de tipo
- `InicioPendencias` ganha `emailsNaoLidos: number` (soma das contas conectadas).
- `InicioView` ganha `atualizadoEm: string` (ISO, carimbado no main a cada view montada com sucesso).
- Canal novo de invoke `scribe:inicio-atualizar`: pedido vazio estrito; resposta `{ ok: true; view: InicioView; falhou: boolean }`. `WHEN_LOCKED`: `refused`.

## Critérios de aceite
(testes com dependências falsas que contam chamadas, no padrão de `test/inicio-service.test.ts`)
- CA1. Duas contas com 3 e 2 não lidos na caixa de entrada → `pendencias.emailsNaoLidos === 5`; conta desconectada ou sem dados guardados conta 0; bloco de pendências desligado nas configurações não consulta o email.
- CA2. A contagem de não lidos nunca abre sessão de email nem faz rede (dependência falsa de conexão com contador em zero). O teste existente que proíbe `pendentesEmCache` de abrir sessão passa sem alteração.
- CA3. `changed()` chamado 10 vezes em menos de 1 s (relógio injetado) monta a view no máximo 2 vezes; a última chamada nunca se perde (a view final reflete o estado final). O agrupamento usa temporizador e relógio injetados, com padrão de produção de 1 s.
- CA4. Mudança só em `emailsNaoLidos` muda a assinatura e gera `onChange`; view idêntica continua não gerando. `atualizadoEm` fica fora da assinatura, mas viaja atualizado quando há envio.
- CA5. `atualizar()` do serviço chama, uma vez cada: `calendar.refresh()`, a invalidação do dia do Mac e a releitura da lista de pastas de cada conta de email conectada; depois monta a view. Devolve `falhou: false`.
- CA6. Uma das três fontes rejeita: as outras duas são chamadas mesmo assim, a view é montada com o que houver e `falhou` é `true`; nada é lançado; o log registra só o tipo do erro.
- CA7. Duas chamadas simultâneas de `atualizar()` fazem uma leitura só e recebem a mesma resposta.
- CA8. `scribe:inicio-atualizar` existe em `INVOKE_CHANNELS`, em `WHEN_LOCKED` como `refused`, registrado no main; pedido com campo extra → recusado sem lançar, no padrão dos outros canais do Início.
- CA9. No desbloqueio do app, `inicioChanged()` é chamado uma vez (um ponto só, onde o main já trata o desbloqueio); bloqueado, continua não fazendo nada. Coberto por teste no nível em que o projeto já testa o desbloqueio, ou, se não houver, por função extraída e testada.
- CA10. Chegada de email (o caminho `onMessagesChanged`) não chama modelo, não grava nada e não abre conexão (CA7 da spec): teste com dependências que contam.

## Invariantes
- `scribe:inicio-get` e `scribe:inicio-changed` continuam com os mesmos nomes; só ganham os campos novos.
- Nenhum comportamento do email muda (notificações, tela Email, triagem). Nenhuma chamada a `runClaudeOneShot` ou ACP nova.
- Com o app bloqueado nada é enviado ao renderer.
- O renderer pode ficar com erro de tipo zero: acrescente o mínimo no renderer só se o typecheck exigir (por exemplo, um objeto de teste), sem mudar a tela.

## Fora de escopo
- Botão, textos e linha nova na tela; smoke; guia e design.md (contrato 146).

## Gates
`pnpm typecheck && pnpm lint && pnpm test`, da raiz. Testes novos: CA1 a CA10.

## Relatório final
Arquivos alterados; resultado dos três comandos com contagem; de onde vem a contagem de não lidos (função e por que não faz rede); critérios adaptados. Não commitar.
