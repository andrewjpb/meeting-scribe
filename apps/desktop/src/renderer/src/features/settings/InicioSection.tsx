import type { InicioSettings, InicioTela } from '@shared/settings-defaults'
import {
  INICIO_AGENDA_DESCRIPTION,
  INICIO_AGENDA_NAME,
  INICIO_AUTOMACOES_DESCRIPTION,
  INICIO_AUTOMACOES_NAME,
  INICIO_PENDENCIAS_DESCRIPTION,
  INICIO_PENDENCIAS_NAME,
  INICIO_SECTION,
  INICIO_TAREFAS_DESCRIPTION,
  INICIO_TAREFAS_NAME,
  INICIO_TELA_DESCRIPTION,
  INICIO_TELA_NAME,
  INICIO_ULTIMA_REUNIAO_DESCRIPTION,
  INICIO_ULTIMA_REUNIAO_NAME,
} from '@shared/settings-index'
import { useSettings } from '../../app/settingsStore'
import { Section } from '../../design/Section'
import { Segmented } from '../../design/Segmented'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'

const TELAS: readonly { value: InicioTela; label: string }[] = [
  { value: 'inicio', label: 'Início' },
  { value: 'reunioes', label: 'Reuniões' },
]

type Bloco = keyof InicioSettings['blocos']

/** Os cinco blocos da tela Início, na ordem da tela (agenda, depois os cartões de cima para baixo). */
const BLOCOS: readonly { bloco: Bloco; id: string; name: string; description: string }[] = [
  { bloco: 'agenda', id: 'settings-inicio-agenda', name: INICIO_AGENDA_NAME, description: INICIO_AGENDA_DESCRIPTION },
  { bloco: 'tarefas', id: 'settings-inicio-tarefas', name: INICIO_TAREFAS_NAME, description: INICIO_TAREFAS_DESCRIPTION },
  { bloco: 'pendencias', id: 'settings-inicio-pendencias', name: INICIO_PENDENCIAS_NAME, description: INICIO_PENDENCIAS_DESCRIPTION },
  { bloco: 'ultimaReuniao', id: 'settings-inicio-ultima-reuniao', name: INICIO_ULTIMA_REUNIAO_NAME, description: INICIO_ULTIMA_REUNIAO_DESCRIPTION },
  { bloco: 'automacoes', id: 'settings-inicio-automacoes', name: INICIO_AUTOMACOES_NAME, description: INICIO_AUTOMACOES_DESCRIPTION },
]

/**
 * "Início" (contrato 136, D13) na aba Geral, logo depois de "Janela": a tela em que o app abre (Início, o padrão, ou
 * Reuniões; vale na próxima abertura, D2) e um interruptor por bloco da tela Início (desligado, o bloco não aparece).
 * A tela e os blocos vão sempre juntos em `inicio`.
 */
export function InicioSection() {
  const inicio = useSettings((state) => state.settings.inicio)
  const update = useSettings((state) => state.update)

  return (
    <Section title={INICIO_SECTION}>
      <SettingRow name={INICIO_TELA_NAME} nameId="settings-inicio-tela" description={INICIO_TELA_DESCRIPTION}>
        <Segmented value={inicio.telaInicial} options={TELAS} labelledBy="settings-inicio-tela" dataName="inicio-tela-option" onChange={(telaInicial) => void update({ inicio: { ...inicio, telaInicial } })} />
      </SettingRow>
      {BLOCOS.map(({ bloco, id, name, description }) => (
        <SettingRow key={bloco} name={name} nameId={id} description={description}>
          <Switch checked={inicio.blocos[bloco]} labelledBy={id} onChange={(ligado) => void update({ inicio: { ...inicio, blocos: { ...inicio.blocos, [bloco]: ligado } } })} />
        </SettingRow>
      ))}
    </Section>
  )
}
