import { Clock } from 'lucide-react'
import { useState } from 'react'
import { TAREFAS_HORA_RE } from '@shared/settings-defaults'
import {
  TAREFAS_AVISO_DESCRIPTION,
  TAREFAS_AVISO_NAME,
  TAREFAS_HORA_DESCRIPTION,
  TAREFAS_HORA_NAME,
  TAREFAS_LEMBRAR_DESCRIPTION,
  TAREFAS_LEMBRAR_NAME,
  TAREFAS_SECTION,
  TAREFAS_SECTION_DESCRIPTION,
  TAREFAS_SUGERIR_DESCRIPTION,
  TAREFAS_SUGERIR_NAME,
} from '@shared/settings-index'
import { useSettings } from '../../app/settingsStore'
import { TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'

/**
 * "Hora do lembrete" (R34): grava no blur ou no Enter só uma hora HH:MM válida. Fora disso não grava e, ao sair do
 * campo, volta ao último valor salvo, sem mensagem (como o campo de dias do funil).
 */
function TarefasHoraRow() {
  const tarefas = useSettings((state) => state.settings.tarefas)
  const update = useSettings((state) => state.update)
  const saved = tarefas.horaLembrete
  const [draft, setDraft] = useState(saved)
  // Gravado (aqui ou em outra janela): o campo passa a mostrar o valor novo.
  const [shownFor, setShownFor] = useState(saved)
  if (shownFor !== saved) {
    setShownFor(saved)
    setDraft(saved)
  }

  const commit = (leaving: boolean): void => {
    const hora = draft.trim()
    if (!TAREFAS_HORA_RE.test(hora)) {
      if (leaving) setDraft(saved)
      return
    }
    if (hora === saved) {
      setDraft(saved)
      return
    }
    void update({ tarefas: { ...tarefas, horaLembrete: hora } }).then((ok) => {
      if (!ok) setDraft(saved)
    })
  }

  return (
    <SettingRow name={TAREFAS_HORA_NAME} nameId="settings-tarefas-hora" htmlFor="settings-tarefas-hora-field" description={TAREFAS_HORA_DESCRIPTION}>
      <div className="relative flex w-24 shrink-0 items-center">
        <TextField
          id="settings-tarefas-hora-field"
          inputMode="numeric"
          placeholder="HH:MM"
          value={draft}
          onChange={setDraft}
          onEnter={() => commit(false)}
          onBlur={() => commit(true)}
          maxLength={5}
          data={{ 'data-tarefas-hora': '' }}
        />
        <Icon icon={Clock} size={14} className="pointer-events-none absolute right-2.5 text-text-muted" />
      </div>
    </SettingRow>
  )
}

/**
 * "Tarefas" (contrato 128, R34) na aba Geral, logo abaixo do Funil de vendas: a hora do lembrete, o lembrete no prazo,
 * o aviso diário "Hoje" e as sugestões das reuniões. Os quatro valores vão sempre juntos em `tarefas`.
 */
export function TarefasSection() {
  const tarefas = useSettings((state) => state.settings.tarefas)
  const update = useSettings((state) => state.update)

  return (
    <Section title={TAREFAS_SECTION} description={TAREFAS_SECTION_DESCRIPTION}>
      <TarefasHoraRow />
      <SettingRow name={TAREFAS_LEMBRAR_NAME} nameId="settings-tarefas-lembrar" description={TAREFAS_LEMBRAR_DESCRIPTION}>
        <Switch checked={tarefas.lembrarNoPrazo} labelledBy="settings-tarefas-lembrar" onChange={(lembrarNoPrazo) => void update({ tarefas: { ...tarefas, lembrarNoPrazo } })} />
      </SettingRow>
      <SettingRow name={TAREFAS_AVISO_NAME} nameId="settings-tarefas-aviso" description={TAREFAS_AVISO_DESCRIPTION}>
        <Switch checked={tarefas.avisoDiario} labelledBy="settings-tarefas-aviso" onChange={(avisoDiario) => void update({ tarefas: { ...tarefas, avisoDiario } })} />
      </SettingRow>
      <SettingRow name={TAREFAS_SUGERIR_NAME} nameId="settings-tarefas-sugerir" description={TAREFAS_SUGERIR_DESCRIPTION}>
        <Switch checked={tarefas.sugerirDasReunioes} labelledBy="settings-tarefas-sugerir" onChange={(sugerirDasReunioes) => void update({ tarefas: { ...tarefas, sugerirDasReunioes } })} />
      </SettingRow>
    </Section>
  )
}
