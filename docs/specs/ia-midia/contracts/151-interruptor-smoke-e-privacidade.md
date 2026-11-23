# Contrato 151 — IA e mídia: interruptor em Configurações, passos da resposta, check de ponta a ponta e privacidade

Feature: ia-midia  ·  Wave: 3 (antecipada para a versão 0.23.1)  ·  Depende de: 149

Constituição: `CLAUDE.md` do usuário e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Contrato 149 aceito e commitado: ferramentas `ver_midia_whatsapp`, `transcrever_audio_whatsapp`, `ler_anexo_email`; `settings.assistant.media` (padrão ligado); recusa de ferramentas que alteram no turno com mídia.
- Desenho aprovado pelo Andrew em 23/11/2026: `docs/specs/ia-midia/mockups/png/01-configuracoes-claro.png`, `-escuro.png` e `02-assistente-passos-claro.png` (fonte `mockups/IaMidia.html`), com as decisões: os passos ficam no gerúndio, como os atuais; a descrição do interruptor cita o atendimento só quando o contrato 150 existir (aqui, não cita).
- Reordenação de 23/11/2026: a parte do Assistente sai na versão 0.23.1; o atendimento com mídia (contrato 150), a opção no painel Atendimento e o smoke do atendimento ficam para depois e NÃO entram aqui.

## Contexto mínimo
As Configurações ficam em `apps/desktop/src/renderer/src/features/settings/` (aba Claude, seção "Chat e resumo", linhas `SettingRow` + `Switch`; há uma busca de configurações com palavras-chave). Os passos da resposta do Assistente são renderizados em `features/chat/` (procure `stepIcon`). O smoke (`src/main/smoke.ts`) tem checks do Assistente que usam o Claude falso `apps/desktop/test/fixtures/fake-claude.mjs` (ramos escolhidos pelo começo da instrução ou pelo texto da pergunta) e o WhatsApp falso (`backend_fake.py`): a conversa do Bruno tem uma imagem PNG, um áudio WAV, um PDF (m9) e uma figurinha (m10); a AssemblyAI é simulada em `smoke-fixtures.ts`.

## Superfície
- Renderer: `features/settings/*` (linha nova + busca) e `features/chat/*` (ícones dos passos novos).
- `apps/desktop/src/main/smoke.ts`, `smoke-fixtures.ts` e `apps/desktop/test/fixtures/fake-claude.mjs` (check novo).
- Documentação: `README.md`, `apps/desktop/resources/assistente/guia-do-app.md`, `services/whatsapp-bridge/README.md`.
- Testes do renderer que travam a lista de configurações/busca, se houver.

## Critérios de aceite
### Configurações
- CA1. Aba Claude › "Chat e resumo", logo depois de "Modelo do chat": linha "A IA pode abrir imagens e transcrever áudios" com `Switch` (`data-setting="assistant-media"`), ligada por padrão, e a descrição: "Ao responder, o Assistente abre imagens e PDFs e transcreve áudios das conversas e emails que já pode ler. Imagens e PDFs vão para o Claude; áudios vão para a AssemblyAI e só o texto vai para o Claude."
- CA2. Desligar grava `settings.assistant.media = false` pelo mesmo caminho das outras configurações; religar volta. A busca das Configurações acha a linha por: mídia, imagem, foto, print, áudio, PDF, anexo, transcrição, AssemblyAI, privacidade.
### Passos
- CA3. Os passos de mídia aparecem com ícone próprio (`lucide`, 14 px como os demais): imagem `Image`, PDF `FileText`, áudio `AudioLines`, anexo `Paperclip`; os rótulos são os que o main já manda ("Abrindo uma imagem", "Abrindo um PDF", "Transcrevendo um áudio", "Lendo um anexo", e os de leitura do arquivo aberto). Nenhum passo existente muda.
### Smoke (grupo novo `midia`, checks nomeados no `report.json`)
- CA4. `imagem`: com a fonte WhatsApp ligada e a conversa do Bruno no contexto, uma pergunta ao Assistente faz o Claude falso pedir `ver_midia_whatsapp` da imagem do Bruno; o check confere que um arquivo `Midia - WhatsApp - ….png` passou a existir na pasta da conversa, que o passo "Abrindo uma imagem" apareceu na resposta e que a resposta final chegou.
- CA5. `audio`: idem com `transcrever_audio_whatsapp` no áudio do Bruno; confere uma chamada à AssemblyAI falsa, o passo "Transcrevendo um áudio" e que uma segunda pergunta igual não transcreve de novo.
- CA6. `desligado`: com o interruptor desligado pela tela de Configurações, a mesma pergunta não gera arquivo de mídia nem chamada de transcrição, e os arquivos `Midia - …` da pasta somem; o check religa o interruptor no fim.
- CA7. `acaoRecusada`: num turno em que a imagem foi aberta, o Claude falso pede em seguida uma ferramenta que altera (use a de organizar email já coberta pelo smoke, ou `criar_pasta`): nada é alterado e a resposta final chega. Se o smoke não tiver conta de email nesse ponto, relate e cubra pelo teste unitário existente.
- CA8. Um print novo: `configuracoes-claude-midia-light` (a seção com o interruptor visível); `expectedShots` sobe em 1 com o comentário do contrato 151. Todos os checks e prints existentes continuam passando.
### Documentação
- CA9. `README.md`: na parte de privacidade (o que sai da máquina), entra que, com a função ligada, imagens e PDFs das conversas e emails que o Assistente pode ler vão para o Claude quando ele precisa, e áudios e vídeos vão para a AssemblyAI (só a transcrição vai para o Claude); que se desliga em Configurações › Claude; que os botões "Baixar" e "Transcrever" da tela continuam por clique. Saem ou são corrigidas as frases "áudio do WhatsApp só no clique em Transcrever" e "áudio, imagem e vídeo só baixam no clique em Baixar" onde elas afirmam que é o único caminho. A frase "o agente de atendimento não lê áudio, imagem nem arquivo" CONTINUA (o contrato 150 ainda não existe).
- CA10. `guia-do-app.md`: seção do Assistente ganha o que ele faz com mídia (abre imagem, figurinha e PDF do WhatsApp; transcreve áudio e a fala de vídeo; lê anexo de email: imagem, PDF, áudio, texto; não lê Word, Excel nem vídeo como imagem; até 8 mídias por pergunta), que diz quando se baseou em mídia, que **na pergunta em que abriu mídia ele não move emails nem cria pasta ou rascunho: pede que você confirme numa nova pergunta**, e onde desligar. Seção Privacidade coerente com o README. Marcadores `<!-- tela: … -->` intactos.
- CA11. `services/whatsapp-bridge/README.md`: "só quando o app pede" continua verdadeiro, com a nota de que o pedido pode vir do Assistente e não só do clique.
- CA12. Textos em pt-BR, sem jargão nem nome de arquivo de código; nenhuma promessa que o app não cumpre.

## Invariantes
- Nenhum arquivo de `src/main` muda, fora `smoke.ts` e `smoke-fixtures.ts`. Nenhum canal novo.
- A tela do WhatsApp e o painel Atendimento não mudam.

## Fora de escopo
- Atendimento com mídia e sua opção no painel (contrato 150 e seguinte); apresentação e teste navegado.

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`, da raiz (tela do Mac desbloqueada; se parar por tela bloqueada, relate sem contornar).

## Relatório final
Arquivos alterados; resultado de cada passo dos gates com contagens; os checks novos com o resultado; o que se vê no print novo; defeitos encontrados nas ferramentas de mídia ao rodá-las de verdade (não corrija: relate); critérios adaptados. Não commitar.
