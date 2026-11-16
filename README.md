# LAP Reuniões (Meeting Scribe)

App de desktop para macOS que transcreve reuniões em tempo real — microfone e áudio do sistema, sem driver virtual e sem interferir no Zoom, Meet ou Teams — e traduz ao vivo.

## O que faz

- Transcrição ao vivo do microfone ("Você") e do áudio do sistema ("Participantes") pela AssemblyAI (streaming v3).
- Tradução ao vivo pela AssemblyAI (LLM Gateway) ou pelo `claude` instalado no Mac.
- Remove o eco do alto-falante que vaza para o microfone.
- Grava o áudio (`.m4a`) e a transcrição (`.md`) numa pasta do Mac.
- Resumo ao encerrar: o que aconteceu, decisões e tarefas com responsável (pelo `claude` local).
- Identificação de quem fala (opcional).
- Avisa quando sai versão nova no GitHub Releases, baixa o `.dmg`, confere o SHA-256 e abre para instalar.

Em andamento: marca personalizável, lista de reuniões com busca, anotações em post-its, Google Drive, agendas Google e Microsoft com avisos.

## Requisitos

- macOS 14.4 ou mais novo (Core Audio Tap), Apple Silicon.
- Node.js 24 e pnpm.
- Uma chave da AssemblyAI (colada no app, guardada no Chaveiro do macOS).
- Opcional: [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`) para tradução e resumo.

## Rodar e montar

```bash
pnpm install
pnpm --filter @meeting-scribe/desktop dev     # desenvolvimento
bash apps/desktop/scripts/gates.sh             # typecheck, lint, testes, build, smoke
pnpm --filter @meeting-scribe/desktop pack     # gera apps/desktop/dist/LAP-Reunioes-<versão>-arm64.dmg e o .sha256 (assinatura ad-hoc)
```

O `.dmg` não é assinado pela Apple: no primeiro uso, abra com botão direito → Abrir.

## Publicar uma versão

O app procura versão nova em `https://api.github.com/repos/andrewjpb/meeting-scribe/releases/latest` 30 s depois de abrir, a cada 6 h (Configurações → Atualizações → "Procurar atualizações automaticamente") e pelo botão "Procurar atualização". Só a versão vai no pedido (`User-Agent: LAP-Reunioes/<versão>`). Com versão nova, baixa `LAP-Reunioes-<versão>-arm64.dmg` do release, confere contra o `.sha256` ao lado e abre o `.dmg`; a pessoa arrasta para Aplicativos. Sem conta de desenvolvedor Apple o app não se substitui sozinho.

```bash
bash apps/desktop/scripts/release.sh 0.2.0
```

O script confere a árvore limpa e a branch `main`, roda os gates, sobe a versão no `package.json`, roda o `pack.sh`, faz o commit "versão 0.2.0" e a tag `v0.2.0` locais e escreve um rascunho de notas em `apps/desktop/dist/notas-v0.2.0.md`. Ele não faz push nem publica: no fim imprime os comandos para rodar à mão, depois de revisar as notas:

```bash
git push origin main v0.2.0
cd apps/desktop && gh release create v0.2.0 dist/*.dmg dist/*.sha256 --title "LAP Reuniões 0.2.0" --notes-file dist/notas-v0.2.0.md
```

Pré-release e rascunho não são oferecidos ao app. O pacote é só Apple Silicon (arm64); o `pack.sh` e o `release.sh` param num Mac Intel.

Se o `release.sh` falhar no meio, ele mesmo volta a versão no `package.json`. Se o commit "versão X" já tiver sido feito e a tag não, termine com `git tag vX` ou desfaça com `git reset --hard HEAD~1` (a árvore estava limpa antes).

## Estrutura

- `apps/desktop/` — o app (Electron + React + TypeScript).
- `docs/specs/desktop-shell/` — spec, design e contratos de cada etapa.
- `docs/fase0.md` e `docs/fase0/` — prova técnica (captura de áudio, provedores).
- `prova/` — app mínimo da prova técnica.

## Privacidade

O áudio vai só para a AssemblyAI durante a gravação; a transcrição vai ao `claude` local só para traduzir e resumir. Arquivos ficam no seu Mac. Chaves e tokens ficam cifrados (Chaveiro do macOS).

## Licença

[MIT](LICENSE) © LAP Software
