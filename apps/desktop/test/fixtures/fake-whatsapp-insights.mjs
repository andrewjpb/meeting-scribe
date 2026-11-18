// Detalhes falsos da conversa do WhatsApp (contrato 32) que o `claude` falso e o agente ACP falso devolvem: montados só
// com o pedido, sempre iguais para o mesmo pedido. O resumo diz o nome da conversa e quantas mensagens vieram (o smoke
// confere que as duas coisas chegaram); o humor de cada dia sai das datas das linhas (`[dd/mm hh:mm]`), com o ano de
// <hoje>, positivo nos dias pares e neutro nos ímpares.

/** Espera antes de responder: dá tempo de a tela mostrar "Analisando…". */
export const FAKE_INSIGHTS_DELAY_MS = 600

export function fakeWhatsAppInsights(content) {
  const name = /<conversa nome="([^"]*)"/.exec(content)?.[1] ?? ''
  const today = /<hoje>(\d{4})-\d{2}-\d{2}<\/hoje>/.exec(content)?.[1] ?? '2026'
  const body = /<conversa[^>]*>\n([\s\S]*?)\n<\/conversa>/.exec(content)?.[1] ?? ''
  const lines = body.split('\n').filter((line) => /^\[\d{2}\/\d{2} \d{2}:\d{2}\] /.test(line))
  const days = [...new Set(lines.map((line) => /^\[(\d{2})\/(\d{2})/.exec(line)).filter(Boolean).map((match) => `${today}-${match[2]}-${match[1]}`))].sort()
  return {
    resumo: `Conversa com ${name}: ${lines.length} mensagens lidas pelo Claude falso. A proposta foi ajustada e segue para a diretoria; a reunião de sexta está quase confirmada.`,
    pontos: ['A proposta foi revisada e a segunda fase teve o valor ajustado.', 'A reunião de sexta ainda precisa de confirmação.'],
    humor: { valor: 'positivo', justificativa: 'Tom cordial e agradecido nas últimas mensagens.' },
    humorDias: days.slice(-14).map((dia, index) => ({ dia, valor: index % 2 === 0 ? 'positivo' : 'neutro' })),
    pendencias: { minhas: ['Confirmar a reunião de sexta.'], deles: ['Levar a pauta da reunião.'] },
    compromissos: [{ texto: 'Reunião para fechar a proposta', quando: 'sexta' }, { texto: 'Retorno da diretoria', quando: null }],
  }
}
