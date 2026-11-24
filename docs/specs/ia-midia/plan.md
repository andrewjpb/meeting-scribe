---
status: aprovada
feature: ia-midia
tipo: plan
data: 2026-11-23
semana: 2026-W48
---

# Plan — A IA vê imagens, áudios e anexos

## Decisões técnicas
- D1. No Assistente, mídia entra por **ferramentas `lap-ferramenta`** que gravam o arquivo na pasta da conversa; a IA abre com o `Read` que já tem. Funciona em ACP e na linha de comando, sem mudar permissões.
- D2. Transcrição reaproveita `whatsapp.transcribe()` e `createFileTranscriber` (AssemblyAI, mesma chave); nada de conversão de formato.
- D3. O identificador de mídia no arquivo da conversa é o id da mensagem; a ferramenta confere que a mensagem pertence ao recorte exportado para aquela pergunta.
- D4. Interruptor em `settings` (`assistant.media`, padrão ligado); as ferramentas só são registradas com ele ligado e a fonte correspondente ativa.
- D5. Limpeza: os arquivos de mídia usam um prefixo próprio e entram nas rotinas que já limpam a pasta da conversa.
- D6. Serviço Python: guardar a chave de download de documento e figurinha junto das de imagem, vídeo e áudio.
- D7. Atendimento: o serviço baixa/transcreve **antes** de chamar o motor; áudio vira texto no histórico; imagem vai como bloco de imagem pelo ACP (`runAcpOneShot` ganha entrada de imagens); sem ACP, "passar". `AtendimentoBinding` ganha `media: boolean` (padrão `false`, migração do arquivo).

## Grafo de tarefas
| # | Microtarefa | Arquivos principais | Depende de | Wave |
|---|---|---|---|---|
| 147 | Arquivos de conversa e de email com id de mídia, transcrição guardada e anexos indexados; regra N1 nas instruções | `whatsapp/export.ts`, `email/export.ts`, `claude-cli/chat.ts`, testes | — | 1 |
| 148 | Serviço do WhatsApp baixa documento e figurinha | `services/whatsapp-bridge/*`, `shared/whatsapp.ts` | — | 1 |
| 149 | Ferramentas de mídia do Assistente, limites, limpeza, bloqueio, configuração (sem tela) | `main/chat/*`, `whatsapp/assistant-tools.ts` (novo), `email/assistant-tools.ts`, `settings`, `index.ts`, testes | 147, 148 | 2 |
| 150 | Atendimento lê áudio e imagem (opção por conversa, sem tela) | `shared/atendimento*.ts`, `atendimento/{store,reply,service}.ts`, `acp/summary.ts`, testes | 149 | 3 |
| 151 | Telas: interruptor em Configurações, passos da resposta, opção no painel Atendimento | renderer | 149, 150, mockup aprovado | 4 |
| 152 | Smoke de ponta a ponta, prints, README, guia e README do serviço | `smoke.ts`, docs | 151 | 5 |

## Gates
Rápidos (`pnpm typecheck && pnpm lint && pnpm test`) em 147, 149 e 150; pytest do serviço em 148; gate completo em 151 e 152.

## Ambiguidades
1. Interruptor ligado por padrão (o pedido foi "a IA precisa ver"); quem não quiser desliga.
2. No atendimento a opção nasce desligada por conversa, apesar do pedido incluir o atendimento, por causa do risco 3.
3. Limites de R7 e R14 são proposta; ajustáveis depois do uso.
