// Rascunho falso do WhatsApp (contrato 24) do `claude` falso e do agente ACP falso: só texto, montado com a
// instrução e o nome da conversa do pedido, para o smoke conferir que os dois chegaram.
export function fakeDraft(content) {
  const instruction = /<instrucao>\n([\s\S]*?)\n<\/instrucao>/.exec(content)?.[1] ?? ''
  const name = /<conversa nome="([^"]*)">/.exec(content)?.[1] ?? ''
  return `Oi, ${name.split(' ')[0]}! Confirmado: ${instruction.replace(/^responda\s+/i, '').slice(0, 80)}. Até lá!`
}

