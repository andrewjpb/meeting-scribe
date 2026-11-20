# Contrato 77 — Fechamento da feature Instagram

Feature `redes-instagram` · Wave 4 · Depende de: 69–76 e 79 commitados na branch. **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-redes-instagram`. Decisão do Andrew em 2026-11-20: ao final junta-se tudo na main e sai versão (não é mais "build local"); este contrato prepara a branch para isso, o merge e a release são do coordenador.

## Entregas
1. **Docs permanentes**: `README.md` (seção "### Redes: Instagram" em "O que ele faz": conta por token, armazenamento S3 para imagens, publicações e agendamento, comentários, mensagens, métricas, Assistente; "Privacidade e segurança": token e chaves no cofre do sistema, hosts permitidos, nada publica sem clique; "Estrutura": `main/redes/`, `features/redes/`); `resources/assistente/guia-do-app.md` (confira que o 76 cobriu Redes e Configurações › Contas; complete o que faltar); `docs/specs/desktop-shell/design.md` (bloco "Redes": item raiz, nível, tela com fila e editor em painel, cartões de número das métricas; e as medidas densas do 79 se o 79 não tiver atualizado).
2. **docs/telas**: artboards novos em `docs/telas/artboards/` para Redes (Publicações com fila, Editor, Comentários, Mensagens, Métricas, Contas › Instagram, Sidebar nível Redes) gerados a partir do mockup `RedesInstagram.dc.html` adaptado ao estado final do código (textos e medidas reais, densidade 79), entradas em `canvas.json`, e atualização dos artboards existentes da barra lateral para a densidade 79; `docs/telas/README.md` lista os novos. **Não publique nos artefatos** (publicação é do coordenador, exige permissão do Andrew); deixe os arquivos prontos.
3. **Spec arquivada**: `git mv docs/specs/redes-instagram docs/specs/_archive/redes-instagram` com `status: arquivado` no frontmatter de `spec.md` e `plan.md`; notas de versão preparadas em `docs/specs/_archive/redes-instagram/notas-release.md` (destaques em pt-BR para o Andrew colar nas notas da versão).
4. **Auditoria final dos prints do smoke** (todos os `redes-*`, `contas-instagram*`, `contas-midia-s3*`, `sidebar-*`, `assistente-*`): abra cada um e liste em `docs/specs/_archive/redes-instagram/auditoria-prints.md` o que está fora do padrão (corte, alinhamento, cor, texto técnico, densidade inconsistente); corrija o que for de uma linha; o que for maior vira item na lista de pendências do relatório.
5. **Pendências conhecidas** consolidadas no relatório: Bearer no `/refresh_access_token` a confirmar com token real; foto do perfil bloqueada pela CSP (baixar no main); `HEAD` em `HttpMethod`; limite de 600 s do smoke (meça o tempo total e proponha divisão se passar de 540 s).

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. `expectedShots` final conferido.

## Relatório final
Arquivos; gates; lista de pendências; tempo do smoke; o que o coordenador precisa fazer (merge, versão, publicação dos artefatos).
