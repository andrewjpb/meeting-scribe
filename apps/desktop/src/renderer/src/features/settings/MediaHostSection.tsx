import { CircleCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MEDIA_HOST_FIELDS, MEDIA_HOST_PATH_STYLE_DESCRIPTION, MEDIA_HOST_PATH_STYLE_NAME, MEDIA_HOST_SECTION_DESCRIPTION } from '@shared/settings-index'
import type { MediaHostConfig } from '@shared/redes'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { SettingRow } from '../../design/SettingRow'
import { Switch } from '../../design/Switch'
import { redesDateTime } from '../redes/redesFormat'
import { useRedes, watchRedes } from '../redes/redesStore'

type TextKey = Exclude<keyof MediaHostConfig, 'pathStyle'>
type Fields = Record<TextKey, string> & { pathStyle: boolean }

const EMPTY: Fields = { endpoint: '', region: '', bucket: '', accessKeyId: '', publicBaseUrl: '', pathStyle: true }
const inputId = (key: string): string => `media-host-${key}`

/**
 * Configurações › Contas (contrato 69, R3): a seção "Armazenamento de mídia (S3)". A configuração vai ao main sem
 * voltar a chave secreta: com ela guardada, o campo fica vazio com "••••• guardada" e vazio no Salvar mantém a que
 * está lá. "Testar" (contrato 70) sobe 1 byte e confere a leitura pública; o último resultado fica na nota.
 */
export function MediaHostSection() {
  const status = useRedes((state) => state.state?.mediaHost ?? null)
  const busy = useRedes((state) => state.busy)
  // `null`: o formulário mostra a configuração guardada; a pessoa mexeu, passa a mostrar o que ela digitou.
  const [edited, setEdited] = useState<Fields | null>(null)
  const [secret, setSecret] = useState('')
  /** Por que o último "Salvar" foi recusado; o que foi digitado fica. */
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void useRedes.getState().load()
    return watchRedes()
  }, [])

  const fields: Fields = edited ?? status?.config ?? EMPTY
  const dirty = edited !== null
  const change = (patch: Partial<Fields>): void => {
    setEdited({ ...fields, ...patch })
    setSaveError(null)
  }
  const secretSet = status?.secretSet ?? false
  const configured = status?.configured ?? false
  const complete = MEDIA_HOST_FIELDS.every((field) => field.key === 'secretAccessKey' || fields[field.key].trim() !== '') && (secret.trim() !== '' || secretSet)

  const save = (): void => {
    if (!complete || busy) return
    const config: MediaHostConfig = {
      endpoint: fields.endpoint.trim(),
      region: fields.region.trim(),
      bucket: fields.bucket.trim(),
      accessKeyId: fields.accessKeyId.trim(),
      publicBaseUrl: fields.publicBaseUrl.trim(),
      pathStyle: fields.pathStyle,
    }
    void useRedes
      .getState()
      .saveMediaHost(config, secret.trim() || null)
      .then((saved) => {
        if (!saved) return
        if (!saved.ok) {
          setSaveError(saved.error)
          return
        }
        setSaveError(null)
        setSecret('')
        setEdited(null)
      })
  }
  const clear = (): void => {
    void useRedes
      .getState()
      .clearMediaHost()
      .then((cleared) => {
        if (!cleared) return
        setSecret('')
        setEdited(null)
        setSaveError(null)
      })
  }

  const lastTest = status?.lastTest ?? null
  return (
    <Section title="Armazenamento de mídia (S3)" description={MEDIA_HOST_SECTION_DESCRIPTION}>
      {MEDIA_HOST_FIELDS.map((field) => (
        <SettingRow key={field.key} name={field.name} description={field.description} htmlFor={inputId(field.key)}>
          {field.key === 'secretAccessKey' ? (
            <TextField
              id={inputId(field.key)}
              type="password"
              value={secret}
              onChange={(value) => {
                setSecret(value)
                setSaveError(null)
              }}
              onEnter={save}
              placeholder={secretSet ? '••••• guardada' : ''}
              data={{ 'data-media-host-field': field.key }}
            />
          ) : (
            <TextField
              id={inputId(field.key)}
              value={fields[field.key]}
              onChange={(value) => change({ [field.key]: value })}
              onEnter={save}
              placeholder={field.key === 'endpoint' ? 'https://<conta>.r2.cloudflarestorage.com' : field.key === 'region' ? 'auto' : field.key === 'publicBaseUrl' ? 'https://midia.exemplo.com' : ''}
              data={{ 'data-media-host-field': field.key }}
            />
          )}
        </SettingRow>
      ))}
      <SettingRow name={MEDIA_HOST_PATH_STYLE_NAME} nameId="media-host-path-style" description={MEDIA_HOST_PATH_STYLE_DESCRIPTION}>
        <Switch checked={fields.pathStyle} labelledBy="media-host-path-style" action="media-host-path-style" onChange={(pathStyle) => change({ pathStyle })} />
      </SettingRow>
      <div className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap gap-2">
          <Button action="media-host-save" data={{ 'data-media-host-save': '' }} onClick={save} disabled={busy !== null || !complete}>
            {busy?.kind === 'media-save' ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button action="media-host-test" data={{ 'data-media-host-test': '' }} variant="secondary" onClick={() => void useRedes.getState().testMediaHost()} disabled={busy !== null || !configured || dirty}>
            {busy?.kind === 'media-test' ? 'Testando…' : 'Testar'}
          </Button>
          <Button action="media-host-clear" data={{ 'data-media-host-clear': '' }} variant="danger" onClick={clear} disabled={busy !== null || (!configured && !secretSet)}>
            Remover
          </Button>
        </div>
        {saveError && (
          <div data-media-host-error>
            <Note id="media-host-save-error" icon={TriangleAlert} role="alert">
              {saveError}
            </Note>
          </div>
        )}
        {lastTest && !saveError && (
          <div data-media-host-result={lastTest.ok ? 'ok' : 'error'}>
            <Note id={lastTest.ok ? 'media-host-test-ok' : 'media-host-test-error'} icon={lastTest.ok ? CircleCheck : TriangleAlert} role="status">
              {lastTest.detail} · {redesDateTime(lastTest.at)}
            </Note>
          </div>
        )}
      </div>
    </Section>
  )
}
