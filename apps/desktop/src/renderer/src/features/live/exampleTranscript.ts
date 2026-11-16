// Transcrição de exemplo (N3): conversa fictícia, só para mostrar o formato. Aparece apenas por
// "Ver exemplo", sempre sob a etiqueta "Exemplo", e nunca entra no registro da reunião. O falante
// guarda o rótulo cru do provedor (o mesmo que vem no streaming), e a tela traduz para "Você" e
// "Participante A" com `speakerLabel`.
import type { AudioSource } from '../../audio/frames'

export interface ExampleSegment {
  id: string
  startMs: number
  source: AudioSource
  speaker: string | null
  text: string
  translation: string | null
  partial?: boolean
}

export const EXAMPLE_TRANSCRIPT: readonly ExampleSegment[] = [
  {
    id: 'e1',
    startMs: 4_000,
    source: 'mic',
    speaker: null,
    text: 'Bom dia, pessoal. A ideia hoje é fechar o cronograma da migração e ver quem fica com cada parte.',
    translation: 'Good morning, everyone. The idea today is to settle the migration schedule and see who takes each part.',
  },
  {
    id: 'e2',
    startMs: 13_000,
    source: 'system',
    speaker: 'A',
    text: 'Do nosso lado o banco já está pronto para a cópia. Falta só combinar a janela de manutenção.',
    translation: 'On our side the database is ready for the copy. We just need to agree on the maintenance window.',
  },
  {
    id: 'e3',
    startMs: 22_000,
    source: 'mic',
    speaker: null,
    text: 'Dá para ser no sábado de manhã? Assim sobra o domingo inteiro para conferir.',
    translation: 'Can it be Saturday morning? That leaves all of Sunday to check everything.',
  },
  {
    id: 'e4',
    startMs: 29_000,
    source: 'system',
    speaker: 'B',
    text: 'Sábado funciona. Eu aviso o suporte hoje à tarde e mando o roteiro por e-mail.',
    translation: 'Saturday works. I will let support know this afternoon and email the plan.',
  },
  {
    id: 'e5',
    startMs: 37_000,
    source: 'system',
    speaker: 'A',
    text: 'Só mais uma coisa sobre o acesso dos',
    translation: null,
    partial: true,
  },
]
