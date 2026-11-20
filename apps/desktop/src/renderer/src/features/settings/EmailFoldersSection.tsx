import { FolderPlus, Lock, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { EMAIL_FOLDERS_DESCRIPTION } from '@shared/settings-index'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { Section } from '../../design/Section'
import { treeDelimiter } from '../email/EmailNav'
import { useEmail } from '../email/emailStore'
import { deleteConfirmation, deleteNextStep, flattenTree, folderErrorText, folderNameError, sidebarTree, type FolderItem } from '../email/folderTree'
import { INLINE_INPUT } from '../meetings/menu'
import { EmailRow } from './EmailSignatureSection'

const NUMBER = new Intl.NumberFormat('pt-BR')

/** "1.408 · 3 não lidas", "2", "86 · 1 não lida" (sem "não lidas" quando 0). */
export function folderCountLine(item: Pick<FolderItem, 'total' | 'unseen'>): string {
  const total = NUMBER.format(item.total ?? 0)
  const unseen = item.unseen ?? 0
  return unseen > 0 ? `${total} · ${NUMBER.format(unseen)} ${unseen === 1 ? 'não lida' : 'não lidas'}` : total
}

type Edit = { mode: 'create' | 'rename'; path: string | null; value: string; error: string | null; busy: boolean } | null
type Confirm = { item: FolderItem; contents: { messages: number; folders: number } | null; busy: boolean; error: string | null } | null

/**
 * Configurações › Email › Pastas (contrato 55, CA20, D11): "Nova pasta" (na raiz) e a lista na ordem da barra lateral,
 * com o total e as não lidas; as do sistema com o cadeado e sem botões; nas outras, Renomear no lugar e Apagar com a
 * mesma confirmação do clique direito. O mesmo cache do sidebar: mudar aqui muda lá. Conta POP3: a frase no lugar.
 */
export function EmailFoldersSection({ accountId, pop3 }: { accountId: string; pop3: boolean }) {
  const tree = useEmail((state) => state.trees[accountId])
  const [edit, setEdit] = useState<Edit>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const nodes = tree?.nodes ?? []
  const rows = flattenTree(sidebarTree(nodes))
  const delimiter = treeDelimiter(nodes)

  const submit = async (): Promise<void> => {
    if (!edit || edit.busy) return
    const problem = folderNameError(edit.value, delimiter)
    if (problem) {
      setEdit({ ...edit, error: problem })
      return
    }
    setEdit({ ...edit, busy: true, error: null })
    const store = useEmail.getState()
    const item = edit.path ? rows.find((row) => row.item.path === edit.path)?.item : undefined
    const result = edit.mode === 'create' ? await store.createFolder(accountId, null, edit.value.trim()) : await store.renameFolder(accountId, edit.path ?? '', edit.value.trim(), item?.delimiter ?? delimiter)
    if (!result.ok) setEdit((current) => (current ? { ...current, busy: false, error: folderErrorText(result.error) } : current))
    else setEdit(null)
  }

  const runDelete = async (): Promise<void> => {
    if (!confirm || confirm.busy) return
    setConfirm({ ...confirm, busy: true, error: null })
    // Como no clique direito (CA9): sem `force` primeiro; o conteúdo real vem do servidor.
    const force = deleteConfirmation(confirm.item.label, confirm.contents).force
    const step = deleteNextStep(await useEmail.getState().deleteFolder(accountId, confirm.item.path, confirm.item.delimiter, force), force)
    if (step.kind === 'done') setConfirm(null)
    else if (step.kind === 'confirm') setConfirm((current) => (current ? { ...current, busy: false, contents: step.contents } : current))
    else setConfirm((current) => (current ? { ...current, busy: false, error: step.text } : current))
  }

  const input = (label: string) =>
    edit && (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          // Aberto pelo clique em "Nova pasta" ou "Renomear": o foco vai para ele.
          autoFocus
          data-email-settings-folder-input={edit.mode}
          aria-label={label}
          value={edit.value}
          disabled={edit.busy}
          maxLength={120}
          onChange={(event) => setEdit({ ...edit, value: event.target.value, error: null })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setEdit(null)
            }
          }}
          className={`${INLINE_INPUT} max-w-[320px]`}
        />
        {edit.error && (
          <p role="alert" className="text-12 text-rec">
            {edit.error}
          </p>
        )}
      </div>
    )

  return (
    <Section title="Pastas" anchor="pastas">
      <EmailRow name="Pastas" description={EMAIL_FOLDERS_DESCRIPTION} className="flex flex-col gap-3">
        {pop3 ? (
          <p data-email-settings-folders-pop3 className="text-13 text-text-muted">
            Conta POP3: o app mostra só Caixa de Entrada e Enviados. Para ter pastas, use IMAP nesta conta.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <p className="text-12 text-text-muted">As pastas da conta no servidor. Para mover mensagens, arraste para a pasta na tela de email.</p>
              <Button action="email-settings-folder-new" variant="secondary" icon={FolderPlus} onClick={() => setEdit({ mode: 'create', path: null, value: '', error: null, busy: false })}>
                Nova pasta
              </Button>
            </div>
            {edit?.mode === 'create' && <div className="flex">{input('Nome da nova pasta')}</div>}
            {!tree && <p className="text-12 text-text-muted">Lendo as pastas do servidor…</p>}
            <ul data-email-settings-folders className="flex flex-col">
              {rows.map(({ item, depth }) => (
                <li key={item.path} data-email-settings-folder={item.path} className="flex flex-col border-t border-line first:border-t-0">
                  <div className="flex min-h-8 items-center gap-3 py-1" style={{ paddingLeft: `${depth * 20}px` }}>
                    {edit?.mode === 'rename' && edit.path === item.path ? (
                      input(`Novo nome de ${item.label}`)
                    ) : (
                      <p className="min-w-0 flex-1 truncate text-13 text-text">
                        <span className="font-medium">{item.label}</span> <span className="text-12 text-text-muted tabular">{folderCountLine(item)}</span>
                      </p>
                    )}
                    {item.protected ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-12 text-text-muted">
                        <Icon icon={Lock} size={14} />
                        do sistema
                      </span>
                    ) : (
                      edit?.path !== item.path && (
                        <span className="flex shrink-0 items-center gap-3">
                          <button type="button" data-action="email-settings-folder-rename" onClick={() => setEdit({ mode: 'rename', path: item.path, value: item.label, error: null, busy: false })} className="no-drag text-12 font-medium text-accent">
                            Renomear
                          </button>
                          <button type="button" data-action="email-settings-folder-delete" onClick={() => setConfirm({ item, contents: null, busy: false, error: null })} className="no-drag text-12 font-medium text-rec">
                            Apagar
                          </button>
                        </span>
                      )
                    )}
                  </div>
                  {confirm?.item.path === item.path && (
                    <div data-email-settings-folder-confirm className="mb-2 flex flex-col gap-2 border-l-3 border-rec bg-bg-sunken px-3 py-2" style={{ marginLeft: `${depth * 20}px` }}>
                      <p className="text-13 font-bold text-title">{deleteConfirmation(item.label, confirm.contents).question}</p>
                      {deleteConfirmation(item.label, confirm.contents).warning && <p className="text-12 text-text-muted">{deleteConfirmation(item.label, confirm.contents).warning}</p>}
                      {confirm.error && (
                        <Note id="email-settings-folder-error" icon={TriangleAlert} role="alert">
                          {confirm.error}
                        </Note>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button action="email-settings-folder-delete-confirm" variant="danger" onClick={() => void runDelete()} disabled={confirm.busy}>
                          {deleteConfirmation(item.label, confirm.contents).button}
                        </Button>
                        <Button action="email-settings-folder-delete-cancel" variant="secondary" onClick={() => setConfirm(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </EmailRow>
    </Section>
  )
}
