# Contrato 148 — IA e mídia: o serviço do WhatsApp baixa documento e figurinha

Feature: ia-midia  ·  Wave: 1  ·  Depende de: —

Constituição: `CLAUDE.md` do usuário. Prevalece sobre este contrato.

## Pré-condições
- Spec `docs/specs/ia-midia/spec.md` aprovada pelo Andrew em 23/11/2026.
- Testes do serviço verdes (o passo 8 de `pnpm gates`: pytest em `services/whatsapp-bridge`) e `pnpm typecheck && pnpm lint && pnpm test` verdes.

## Contexto mínimo
O serviço local `services/whatsapp-bridge/` entrega a mídia de uma mensagem por
`GET /chats/:id/messages/:msg/media` (`server.py`), só quando o app pede. Hoje só imagem, vídeo e áudio
baixam: `DOWNLOADABLE_KINDS` em `bridge_store.py` decide de quais mensagens a chave de download é guardada
(`backend_neonize.py` extrai). Documento e figurinha ficam com `downloadable: false`. No app, o espelho da
lista está em `apps/desktop/src/shared/whatsapp.ts`. O backend falso (`backend_fake.py`) serve ao smoke e aos
testes.

## Superfície
- Alterar `services/whatsapp-bridge/bridge_store.py`, `backend_neonize.py`, `backend_fake.py`, `server.py` (se preciso) e os testes em `services/whatsapp-bridge/tests/`.
- Alterar `apps/desktop/src/shared/whatsapp.ts` (lista de tipos que baixam) e os testes do app que a travam.
- `services/whatsapp-bridge/README.md`: a frase sobre o que baixa.

## Critérios de aceite
- CA1. Mensagem nova de documento ou de figurinha é guardada com a chave de download e sai com `downloadable: true`; a rota de mídia devolve os bytes com o mime da mensagem (documento: o mime declarado; figurinha: `image/webp`).
- CA2. Valem as mesmas regras das outras mídias: limite de 64 MB (413), sem chave (404), expirada (410), guarda de 7 dias com limpeza, apagada no logout. Um teste por regra para documento.
- CA3. Mensagens antigas de documento/figurinha, guardadas antes desta mudança, continuam `downloadable: false` e a rota devolve 404, sem erro.
- CA4. O backend falso ganha um documento PDF pequeno e uma figurinha webp baixáveis (em conversa que não altere os checks atuais do smoke), e os testes do backend falso cobrem os dois.
- CA5. O serviço continua sem baixar nada sozinho: nenhum download é disparado por mensagem recebida (teste).
- CA6. `shared/whatsapp.ts` reflete os tipos que baixam; a tela do WhatsApp passa a oferecer "Baixar" para documento e figurinha baixáveis **sem nenhuma mudança de código de tela** (se exigir mudança de tela, pare e relate).
- CA7. README do serviço: a lista do que baixa está correta e a frase "só quando o app pede" continua.

## Invariantes
- Imagem, vídeo e áudio baixam exatamente como antes. Envio de mensagens e de mídia não muda.
- Nenhum check atual do smoke muda de resultado (o smoke completo roda em contrato posterior; aqui, não quebre as fixtures que ele usa: confira os usos de `WA_BRUNO`, `WA_ANA`, `WA_ATLAS` em `apps/desktop/src/main/smoke.ts`).

## Fora de escopo
- Qualquer coisa do Assistente, transcrição ou tela.

## Gates
`pnpm typecheck && pnpm lint && pnpm test` da raiz e o pytest do serviço (o mesmo comando que `apps/desktop/scripts/gates.sh` usa no passo 8). Não rodar o smoke.

## Relatório final
Arquivos alterados; resultado dos comandos com contagens (vitest e pytest); como a chave de documento/figurinha é extraída; critérios adaptados. Não commitar.
