import { useState } from 'react'
import { FUNIL_DIAS_ESFRIAR_MAX, FUNIL_DIAS_ESFRIAR_MIN } from '@shared/settings-defaults'
import {
  FUNIL_AVISAR_DESCRIPTION,
  FUNIL_AVISAR_NAME,
  FUNIL_DETECTAR_DESCRIPTION,
  FUNIL_DETECTAR_NAME,
  FUNIL_DIAS_DESCRIPTION,
  FUNIL_DIAS_NAME,
  FUNIL_SECTION,
} from '@shared/settings-index'
import { useSettings } from '../../app/settingsStore'
import { TextField } from '../../design/Field'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'

/** O texto do campo como dias válidos (inteiro de 1 a 90); fora disso, vazio ou com outro caractere, `null`. */
function parseDias(draft: string): number | null {
  const text = draft.trim()
  if (!/^\d{1,3}$/.test(text)) return null
  const dias = Number(text)
  return dias >= FUNIL_DIAS_ESFRIAR_MIN && dias <= FUNIL_DIAS_ESFRIAR_MAX ? dias : null
}

/**
 * "Considerar esfriada após (dias)" (R46): grava no blur ou no Enter só um inteiro de 1 a 90. Fora disso não grava
 * e, ao sair do campo, volta ao último valor salvo, sem mensagem.
 */
function FunilDiasRow() {
  const funil = useSettings((state) => state.settings.funil)
  const update = useSettings((state) => state.update)
  const saved = funil.diasEsfriar
  const [draft, setDraft] = useState(String(saved))
  // Gravado (aqui ou em outra janela): o campo passa a mostrar o valor novo.
  const [shownFor, setShownFor] = useState(saved)
  if (shownFor !== saved) {
    setShownFor(saved)
    setDraft(String(saved))
  }

  const commit = (leaving: boolean): void => {
    const dias = parseDias(draft)
    if (dias === null) {
      if (leaving) setDraft(String(saved))
      return
    }
    if (dias === saved) {
      setDraft(String(saved))
      return
    }
    void update({ funil: { ...funil, diasEsfriar: dias } }).then((ok) => {
      if (!ok) setDraft(String(saved))
    })
  }

  return (
    <SettingRow name={FUNIL_DIAS_NAME} nameId="settings-funil-dias" htmlFor="settings-funil-dias-field" description={FUNIL_DIAS_DESCRIPTION}>
      <div className="flex w-16 shrink-0">
        <TextField
          id="settings-funil-dias-field"
          inputMode="numeric"
          value={draft}
          onChange={setDraft}
          onEnter={() => commit(false)}
          onBlur={() => commit(true)}
          maxLength={3}
          data={{ 'data-funil-dias': '' }}
        />
      </div>
      <span className="text-13 text-text-muted">dias</span>
    </SettingRow>
  )
}

/**
 * "Funil de vendas" (contrato 109, R46) na aba Geral: detectar oportunidades nas reuniões, os dias para uma
 * oportunidade esfriar e o aviso diário. Os três valores vão sempre juntos em `funil`.
 */
export function FunilSection() {
  const funil = useSettings((state) => state.settings.funil)
  const update = useSettings((state) => state.update)

  return (
    <Section title={FUNIL_SECTION} description="O funil fica em Funil, na barra lateral. Nada entra nele sem o seu clique.">
      <SettingRow name={FUNIL_DETECTAR_NAME} nameId="settings-funil-detectar" description={FUNIL_DETECTAR_DESCRIPTION}>
        <Switch checked={funil.detectarNasReunioes} labelledBy="settings-funil-detectar" onChange={(detectarNasReunioes) => void update({ funil: { ...funil, detectarNasReunioes } })} />
      </SettingRow>
      <FunilDiasRow />
      <SettingRow name={FUNIL_AVISAR_NAME} nameId="settings-funil-avisar" description={FUNIL_AVISAR_DESCRIPTION}>
        <Switch checked={funil.avisarEsfriadas} labelledBy="settings-funil-avisar" onChange={(avisarEsfriadas) => void update({ funil: { ...funil, avisarEsfriadas } })} />
      </SettingRow>
    </Section>
  )
}
