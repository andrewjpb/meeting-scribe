---
feature: email-dashboard
tipo: analise
status: rascunho
criado: 2026-11-23
---

# Análise — Dashboard de e-mails

Levantamento feito em 2026-11-23 (agente Explore) sobre a main `47ad5c1` (0.23.0). Caminhos
relativos a `apps/desktop/src`.

## O que já existe e o dashboard aproveita

| Peça | Onde | Como entra no dashboard |
|---|---|---|
| Cache de INBOX e Enviados (até 200 por conta) e pastas abertas | `main/email/email-store.ts`, `service.ts:645 cached()` | Fonte dos e-mails analisados; nada vai ao servidor para listar. |
| Corpos baixados em `<conta>.bodies/` | `email-store.ts` | Prévia de até 1.500 caracteres enviada ao modelo; corpos ausentes são baixados com teto por passada. |
| Heurística "pendente de resposta" | `main/email/export.ts:114 isPending` | Sinal de entrada do modelo e fallback quando a IA está desligada. |
| Mover com lote e Desfazer | `main/email/organize.ts undoBatch`, `batches.ts`, `EmailBatchCard` | Toda aplicação de "mover" do painel vira lote desfazível, igual ao agente. |
| Composer com rascunho | `features/email/emailStore.ts:91 openDraft`, `EmailScreen.tsx:379 compose` | Resposta sugerida abre no Composer com texto preenchido; falta só o estado de navegação. |
| Passada de IA barata, JSON fechado, Haiku fixo | `main/invites/suggest.ts`, `main/funil/extract.ts`, `main/meetings/claude-one-shot.ts runClaudeOneShot` | Mesmo transporte, mesmo padrão de log (só resultado, modelo, custo e tempo). |
| Sugestões com Adicionar/Ignorar e `ignorados` persistidos | `shared/tarefas-sugestoes.ts`, `features/tarefas/SugestoesTarefas.tsx`, `features/funil/SugestoesList.tsx` | Mesma interação e a mesma chave de ignorado por item. |
| Cartões do Início | `features/inicio/inicioFormat.ts:205 INICIO_CARTAO_CLASS` | Padrão visual dos cartões do painel. |
| Aba Email das Configurações | `features/settings/EmailSettingsTab.tsx` | Interruptor da análise e escolha do modelo entram como seção nova. |
| `+ Contato` e `+ Tarefa` na leitura | `features/funil/ContactLink.tsx`, `ReadingPane.tsx:297` | O painel leva à leitura; não duplica os botões. |

## O que não existe (e o brief supunha)

1. **Triagem por IA** (malicioso, urgência, categoria): nunca foi implementada; ficou como
   pendência em `docs/specs/_archive/desktop-shell/plan-email.md:37`. Não há campo de
   categoria ou urgência na mensagem guardada (`shared/email.ts:107`).
2. **Visões na tela Email**: só pastas (Caixa de Entrada, Enviados, IMAP). Nenhum painel,
   aba ou filtro. "Pendentes" e "Resolvidos" são pastas IMAP criadas pelo agente.
3. **Composer pré-preenchido por navegação**: `EmailNavigationState.compose` leva só `to` e
   `subject` (`shared/routes.ts:101`).
4. **Cartão de resposta na tela Email**: `email-resposta` só existe no chat do Assistente.
5. **Interruptor de IA para e-mail**: não há chave de triagem nas Configurações.

## Restrições que a spec respeita

- `inicio-atualizar` (aprovada, em implementação por outra sessão) proíbe IA no Início e
  mudanças na tela Email vindas dela; este painel não toca o Início.
- POP3 não tem pastas nem mover: contas POP3 recebem só ranking e respostas sugeridas.
- Nenhum conteúdo de e-mail em log; `detail` do smoke só com números e booleanos (R36).
- Nada é enviado nem movido sem clique (premissa herdada do funil e das tarefas; N4 da
  `email-organizacao`).
- Numeração: contratos a partir do **155** (147–154 reservados por `ia-midia` e
  `assistente-cria-atendimento`, em paralelo noutra sessão).

## Tamanho estimado

Quatro contratos em quatro waves sequenciais (dados e lógica pura → passada de IA e IPC →
tela e Configurações → smoke, prints e docs). Um worktree (`email-dashboard`).
