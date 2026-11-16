# LAP Reuniões (Meeting Scribe)

App de desktop para macOS que transcreve reuniões em tempo real — microfone e áudio do sistema, sem driver virtual e sem interferir no Zoom, Meet ou Teams — e traduz ao vivo.

## O que faz

- Transcrição ao vivo do microfone ("Você") e do áudio do sistema ("Participantes") pela AssemblyAI (streaming v3).
- Tradução ao vivo pela AssemblyAI (LLM Gateway) ou pelo `claude` instalado no Mac.
- Remove o eco do alto-falante que vaza para o microfone.
- Grava o áudio (`.m4a`) e a transcrição (`.md`) numa pasta do Mac.
- Resumo ao encerrar: o que aconteceu, decisões e tarefas com responsável (pelo `claude` local).
- Identificação de quem fala (opcional).

Em andamento: marca personalizável, lista de reuniões com busca, anotações em post-its, Google Drive, agendas Google e Microsoft com avisos, atualização pelo GitHub Releases.

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
pnpm --filter @meeting-scribe/desktop pack     # gera apps/desktop/dist/*.dmg (assinatura ad-hoc)
```

O `.dmg` não é assinado pela Apple: no primeiro uso, abra com botão direito → Abrir.

## Estrutura

- `apps/desktop/` — o app (Electron + React + TypeScript).
- `docs/specs/desktop-shell/` — spec, design e contratos de cada etapa.
- `docs/fase0.md` e `docs/fase0/` — prova técnica (captura de áudio, provedores).
- `prova/` — app mínimo da prova técnica.

## Privacidade

O áudio vai só para a AssemblyAI durante a gravação; a transcrição vai ao `claude` local só para traduzir e resumir. Arquivos ficam no seu Mac. Chaves e tokens ficam cifrados (Chaveiro do macOS).

## Licença

[MIT](LICENSE) © LAP Software
