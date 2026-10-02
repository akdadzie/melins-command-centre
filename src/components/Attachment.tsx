// One attachment on a record (A-045): view it through a short-lived signed
// link, or upload / replace it. Files go to the private "documents" bucket at
// <table>/<record id>/<time>-<name>; Storage lets in whoever can read the
// record. On a phone the picker offers the camera, for receipts.
import { useId, useState } from 'react'
import { supabase, db } from '../lib/supabase'
import { friendlyError } from '../resources/useLookups'
import { useAction } from './ui'

export const DOCUMENTS_BUCKET = 'documents'
const MAX_BYTES = 10 * 1024 * 1024

/** File name safe for a storage path: letters, digits, dot, dash, underscore. */
export function safeFileName(raw: string): string {
  const name = raw.split(/[/\\]/).pop()!.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/^\.+/, '')
  const dot = name.lastIndexOf('.')
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file'
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : ''
  return ext ? `${base}.${ext}` : base
}

export function documentPath(table: string, recordId: string, fileName: string, now = Date.now()): string {
  return `${table}/${recordId}/${now}-${safeFileName(fileName)}`
}

export async function openDocument(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 120)
  if (error || !data) return friendlyError(error) || 'The file could not be opened.'
  window.open(data.signedUrl, '_blank', 'noopener')
  return null
}

export function Attachment({ table, column, recordId, path, editable, label = 'Attachment', accept = 'image/*,application/pdf', onChanged }: {
  table: string
  column: string
  recordId: string
  path: string | null | undefined
  editable: boolean
  label?: string
  accept?: string
  onChanged?: (path: string) => void
}) {
  const action = useAction()
  const inputId = useId()
  const [current, setCurrent] = useState(path ?? null)
  const name = current ? current.split('/').pop()!.replace(/^\d+-/, '') : null

  const upload = (file: File | undefined) => file && action.run(async () => {
    if (file.size > MAX_BYTES) return 'The file is over 10 MB. Take a smaller photo or scan.'
    const target = documentPath(table, recordId, file.name)
    const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(target, file, { contentType: file.type || undefined, upsert: false })
    if (error) return friendlyError(error)
    const { data, error: e2 } = await db.from(table).update({ [column]: target }).eq('id', recordId).select('id').maybeSingle()
    if (e2 || !data) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([target])
      return e2 ? friendlyError(e2) : 'The file was not attached: you may not be allowed to change this record.'
    }
    // The old file stays if this person may not delete it; the record now points to the new one.
    if (current) await supabase.storage.from(DOCUMENTS_BUCKET).remove([current]).catch(() => undefined)
    setCurrent(target)
    onChanged?.(target)
  })

  return (
    <div className="attachment">
      <span className="label">{label}</span>
      {name ? <button type="button" className="link" disabled={action.busy} onClick={() => action.run(() => openDocument(current!))}>{name}</button>
        : <span className="muted small">none</span>}
      {editable && <>
        <label htmlFor={inputId} className="button-link small-button">{action.busy ? 'Uploading…' : current ? 'Replace' : 'Upload'}</label>
        <input id={inputId} type="file" accept={accept} hidden disabled={action.busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
      </>}
      {action.error && <span className="form-error small">{action.error}</span>}
    </div>
  )
}
