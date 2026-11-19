# Contrato 54 — Conectores do claude.ai: tela em Configurações › Conexões
Feature: desktop-shell · Wave: 2 · Depende de: 53 · PRD/Plan: `prd-conectores-claude.md`, `plan-conectores-claude.md`

## Pré-condições
- Contrato 53 pronto. O desenho da seção foi APROVADO pelo Andrew antes deste contrato começar (mockup no cofre, regra do `~/CLAUDE.md`).
- Seguir `renderer/src/features/settings/ConnectionsSection.tsx` (contrato 21): mesmos componentes, interruptor, "Ver detalhes" e política por ferramenta.

## Critérios de aceite
- CA1 — A seção **"Conectores do claude.ai"** fica abaixo dos servidores MCP, com uma linha por conector: nome sem o prefixo "claude.ai", estado (Conectado, Precisa autorizar ou Com problema) e interruptor desligado por padrão. O texto "Não dá para usar no app" deixa de aparecer para conector; para plugin continua, porque fica fora de escopo.
- CA2 — Ao ligar um conector pela primeira vez, aparece um aviso de uma linha: "O agente poderá usar o <Nome> da sua conta do claude.ai. Cada ferramenta pergunta antes, até você mudar." Nada de diálogo extra.
- CA3 — "Ver ferramentas" lista as ferramentas do conector (de `claude mcp get` ou do `mcpServerStatus` do 53), cada uma com Perguntar, Permitir ou Negar. O padrão é Perguntar. A política de escrita vem marcada quando o nome sugere escrita (send, create, delete, update): é só um rótulo, sem mudar o padrão.
- CA4 — "Precisa autorizar" mostra o link "Autorizar no claude.ai", que abre no navegador ([claude.ai/settings/connectors](https://claude.ai/settings/connectors)) pelo padrão `scribe:open-link`. Sem login por assinatura, a seção mostra uma frase: "Os conectores do claude.ai só funcionam com o Claude logado pela assinatura."
- CA5 — Ao ligar ou desligar, vale na PRÓXIMA pergunta (sessão nova), e a tela diz isso.
- CA6 — Smoke com o `claude` falso listando 3 conectores (2 conectados e 1 precisa autorizar): ligar 1, a sessão falsa recebe as opções do CA4 do 53, e a política aparece. Prints `conexoes-conectores-light` e `-dark`, passando nos gates de cor e forma.
- CA7 — README (seção de MCP) e `resources/assistente/guia-do-app.md` atualizados com os conectores, o aviso de assinatura e o bloqueio por padrão.

## Invariantes
- A seção dos servidores MCP do contrato 21 fica intacta.

## Fora de escopo
- Autorizar o conector dentro do app; conectores de plugin; MCP de outros apps.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos.
