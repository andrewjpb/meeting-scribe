# Serviço local do WhatsApp (experimental)

> **Antes de conectar o seu WhatsApp.** Este recurso usa um cliente não oficial do WhatsApp (neonize/whatsmeow).
> O WhatsApp pode suspender ou bloquear o seu número, de forma temporária ou definitiva, sem aviso. A LAP não tem
> como desfazer um bloqueio. Use por sua conta e risco.

Serviço pequeno em Python que o LAP Reuniões instala e liga no próprio Mac para ler as suas conversas do
WhatsApp e enviar mensagens **só quando você clica em "Enviar"**. Nada vai para servidor da LAP: a sessão do
WhatsApp e as mensagens ficam em `~/Library/Application Support/Meeting Scribe/whatsapp/`.

## Como o app usa

- **Instalar** (Configurações › Contas › WhatsApp, depois de aceitar o aviso): o app cria um ambiente Python
  isolado em `userData/whatsapp/venv` com o `python3` do sistema (3.10 ou mais novo) e instala
  `requirements.txt` com `pip install --require-hashes`, só do PyPI. É o único momento em que há rede para isso.
- **Ligar**: o app sobe `server.py` como processo filho (morre junto com o app), em `127.0.0.1` e numa porta
  livre. Toda rota exige `Authorization: Bearer <token>`; o token fica num arquivo 0600 que o app cria.
- **Parear**: o app mostra o aviso de risco de novo e só depois desenha o QR code que vem de `GET /pair`.
- **Sair da conta** (`POST /logout`) apaga a sessão e as mensagens guardadas. **Remover** apaga também o ambiente.

## Rotas

| Rota | O que faz |
|---|---|
| `GET /health` | versão e estado: `pairing`, `connected`, `disconnected` ou `banned` |
| `GET /pair` | QR code em texto; com `?phone=5511…`, o código de pareamento por número |
| `POST /logout` | sai da conta e apaga a sessão |
| `GET /chats` | conversas: id, nome, pessoa ou grupo, última mensagem, não lidas |
| `GET /chats/:id/messages?before&limit` | mensagens (texto, autor, hora, tipo; mídia como metadado, com `downloadable` e, no áudio, `seconds`; contrato 34: `replyToId` e `replyPreview` na resposta, `reactions: [{emoji, count, mine}]` na reagida) |
| `GET /chats/:id/messages/:msg/media` | os bytes da imagem, do vídeo, do áudio, do documento (com o mime que a mensagem declara) ou da figurinha (`image/webp`), contrato 148 para os dois últimos (até 64 MB, guardados 7 dias em `media/`); 404 sem as chaves do download, 410 quando o WhatsApp não tem mais o arquivo, 413 acima do limite |
| `GET /chats/:id/photo` | foto de perfil como data URL (até 512 KB, guardada 7 dias em `photos/`), ou `null` |
| `GET /search?q` | busca no texto das mensagens guardadas |
| `POST /chats/:id/send` | envia um texto; responde com o id da mensagem. Contrato 34: com `replyToId`, sai como resposta citando a mensagem guardada (id que não está guardado, ou de grupo sem quem mandou, sai sem citação) |
| `POST /chats/:id/messages/:msg/react` | contrato 34: `{emoji}` com um dos 6 fixos (👍 ❤️ 😂 😮 😢 🙏); vazio tira a sua. Responde com as reações juntas da mensagem; 404 se ela não estiver guardada |
| `POST /chats/:id/presence` | contrato 34: `{state: "composing" \| "paused"}`, o "digitando…" da sua conta. Não é mensagem; o app só chama com "Mostrar quando estou digitando" ligado |
| `POST /chats/:id/send-media` | contrato 39: envia uma imagem (JPEG/PNG/WebP/GIF, até 16 MB) ou um vídeo (MP4/MOV, até 64 MB); os bytes no corpo, o tipo em `X-Media-Mime`, o nome em `X-Media-Name` e a legenda em `X-Caption` (os dois com `encodeURIComponent`). O tipo declarado tem de bater com os primeiros bytes (400); acima do limite, 413; falha do WhatsApp, 502. O eco entra na conversa como mídia baixável |
| `GET /events` | SSE com as mensagens novas e as mudanças de estado; contrato 34: `reactions` (as reações juntas de uma mensagem) e `presence` (`{chatId, state, author}`, alguém digitando; o app apaga o aviso depois de 10 s sem novo evento) |

O serviço nunca envia nada sozinho, não baixa mídia sozinho (só quando o app pede, no clique da pessoa) e não
manda recibo de leitura. Mensagens gravadas antes do contrato 37 (documento e figurinha: antes do contrato 148) não têm as chaves do download e não baixam. Logs não levam texto de
mensagem.

O "digitando…" dos outros (contrato 34) pode não chegar enquanto o WhatsApp não tratar a conta como disponível; o
serviço não marca a conta como disponível sozinho, porque isso muda o "online" que os contatos veem e as notificações do
celular.

## Desenvolvimento

`backend_fake.py` é o cliente falso (sem neonize, sem rede) usado pelos testes e pelo smoke do app. Os testes
rodam no `apps/desktop/scripts/gates.sh`, num ambiente próprio em `.venv-test/` com `requirements-dev.txt`:

```bash
python3 -m venv .venv-test && .venv-test/bin/pip install --require-hashes -r requirements-dev.txt
.venv-test/bin/python -m pytest -q tests
```

Licenças: o neonize 0.10.0 é Apache-2.0 e embute o whatsmeow, MPL-2.0. O app é MIT e não copia código de
nenhum dos dois; o serviço só os instala no Mac de quem pediu.

Pré-requisito do neonize no Mac: a `libmagic` (`brew install libmagic`), usada pelo `python-magic`.

Só para enviar vídeo (contrato 39): o `ffmpeg` e o `ffprobe` (`brew install ffmpeg`), procurados no PATH, em `/opt/homebrew/bin` e em `/usr/local/bin`; a duração e a miniatura saem deles, localmente. Sem eles, `send-media` de vídeo responde 503 `{"error": "ffmpeg"}` e o app explica como instalar; imagem e texto não precisam do ffmpeg.
