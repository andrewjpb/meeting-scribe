---
feature: notificacoes-triagem-correcoes
versao: 0.26.1
data: 2026-11-24
semana: 2026-W48
---

# Notas da versão: correções da triagem do WhatsApp (destaques para o release)

Correções pequenas encontradas no teste navegado da 0.24.0, todas dentro das telas já existentes:

- **Abas do WhatsApp**: com o agente de triagem pausado ou desligado, as abas Urgentes, Pessoal e Profissional dizem que não há agente ativo e oferecem "Abrir Automações" (ou "Criar agente de triagem" quando não existe tarefa), em vez de "Nenhuma conversa aqui.".
- **Triar agora**: respeita "Incluir grupos" da tarefa (num grupo fora da triagem, explica em vez de triar), mostra "Triando…" até a triagem terminar, e a execução manual fica marcada com "· Triar agora" na aba Execuções. O aviso de recusa aparece inteiro, numa segunda linha da barra da etiqueta.
- **Agendamentos**: a tarefa de triagem não tem mais "Rodar agora" nem "Rodar de novo" (ela só roda quando chega mensagem); o formulário do gatilho WhatsApp esconde Saída, post-it e e-mail, que não se aplicam, e explica a frequência.
- **Execuções**: o detalhe mostra o nome do agente que respondeu (por exemplo "Triagem do WhatsApp") em vez de "Claude".
- **Notificações**: "Marcar como lida" aparece também ao navegar por teclado.
- **Agente modelo "Triagem do WhatsApp"**: instruções mais explícitas sobre contato do funil e sobre o que não é urgente; o motivo da etiqueta é curto e nunca cortado no meio de uma palavra.
