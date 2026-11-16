# Contrato 14 — Atualização pelo GitHub Releases (avisa, baixa e abre o instalador)
Feature: desktop-shell  ·  Wave: 10b (pode entrar logo depois do 09)  ·  Depende de: 09

## Pré-condições
- Contrato 09 aceito; `gates.sh` verde; `scripts/pack.sh` gera o `.dmg`.
- Decisão do Andrew (15/11/2026 21:05): projeto **open source (MIT)**, repositório **público** `andrewjpb/meeting-scribe` no GitHub, e o próprio repositório serve para atualizar o app. Sem conta de desenvolvedor Apple: o macOS não deixa o app se substituir sozinho (Squirrel.Mac exige assinatura Developer ID). Escolha: **avisar, baixar o `.dmg` e abrir**; a pessoa arrasta para Aplicativos. Quando houver conta Apple, troca para automático (fora deste contrato).

## Superfície
- `src/main/updates/` (novo), `src/shared/` (tipos, IPC), preload, settings.
- `features/settings/` (bloco "Atualizações"), um aviso discreto no app (barra lateral ou faixa).
- `apps/desktop/package.json` (versão), `scripts/pack.sh` (nome do `.dmg` com a versão e `latest.json`), `scripts/release.sh` (novo).
- `src/main/smoke.ts` + fixtures.

## Critérios de aceite
- CA1: o main consulta `https://api.github.com/repos/andrewjpb/meeting-scribe/releases/latest` (`net.fetch`, `Accept: application/vnd.github+json`, `User-Agent: LAP-Reunioes/<versão>`), ao abrir o app (30 s depois), a cada 6 h e pelo botão "Procurar atualização". Compara `tag_name` (`v0.2.0`) com `app.getVersion()` por semver (ignora pré-release e rascunho). Procura no release o asset `LAP-Reunioes-<versão>-arm64.dmg` e o `LAP-Reunioes-<versão>-arm64.dmg.sha256`. Repo configurável só por constante no código. Erros e falta de internet são silenciosos (só registram no log de desenvolvimento). Testes com API falsa (versão maior, igual, menor, pré-release, sem asset, 403 de limite).
- CA2: com versão nova: na barra lateral, acima das permissões, um aviso discreto "Nova versão 0.2.0" com o botão "Atualizar" (sem pílula, sem sombra, tokens de destaque). Configurações → bloco **"Atualizações"**: versão atual, "Procurar atualização", última verificação, e com versão nova as notas do release (texto do `body`, mostrado como texto simples, até 2 000 caracteres) e "Baixar e instalar". Interruptor "Procurar atualizações automaticamente" (padrão ligado). Smoke: `configuracoes-atualizacoes-light.png`.
- CA3: "Atualizar": baixa o `.dmg` no main (só de `https://github.com/andrewjpb/meeting-scribe/releases/download/` ou do redirecionamento para `objects.githubusercontent.com`/`release-assets.githubusercontent.com`) para `~/Downloads/` (`.part` + renomear), mostrando "Baixando… 42%"; confere o SHA-256 contra o arquivo `.sha256` do release (diferente = apaga e mostra "O arquivo baixado não confere. Tente de novo."); abre o `.dmg` (`shell.openPath`) e mostra a instrução "Arraste o LAP Reuniões para Aplicativos e substitua. Depois abra de novo." com o botão "Fechar o app agora" (`app.quit()` — nunca fecha sozinho durante uma gravação; gravando, o botão fica desabilitado com "Termine a gravação antes."). Testes do main.
- CA4: `scripts/pack.sh` passa a gerar `dist/LAP-Reunioes-<versão>-arm64.dmg` e o `.sha256` ao lado. `scripts/release.sh <versão>` (novo): confere árvore limpa e branch `main`, roda `gates.sh`, sobe a versão no `package.json`, roda o `pack.sh`, faz o commit "versão <versão>" e a tag `v<versão>`, e imprime o comando `gh release create v<versão> dist/*.dmg dist/*.sha256 --notes-file <arquivo>` para o Andrew rodar (o script **não** publica nem faz push sozinho). Documentado no README.
- CA5: o app fica igual sem internet ou sem release no GitHub. Nenhum dado do usuário vai no pedido (só a versão no `User-Agent`). Destinos de rede novos: só os do CA1 e CA3.
- CA6: smoke com API e download falsos: versão maior aparece na barra e nas Configurações, download confere o hash e chama o `openPath` substituto; hash errado mostra o erro; `externalRequests: []`.

## Invariantes
- Contratos 01 a 09 continuam passando. Nenhum push, tag remota ou release é feito por código do app ou por script sem o Andrew rodar o comando.
- `prova/` e `docs/` não mudam.

## Fora de escopo
- Atualização silenciosa (Squirrel/electron-updater), assinatura e notarização Apple, canal beta, Intel (x64), Windows.

## Gates
- `gates.sh` (smoke à mão com `--no-sandbox`) e `scripts/pack.sh`.

## Telas de impacto no usuário
- Barra lateral: "Nova versão" com "Atualizar". Configurações: bloco "Atualizações".

## Notas do coordenador
- Nada de commit pelo implementador; quem commita é o coordenador, pelo agente `git-commit`.
