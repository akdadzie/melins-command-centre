import { useState } from 'react'
import Papa from 'papaparse'
import { useQueryClient } from '@tanstack/react-query'
import { db } from '../lib/supabase'
import type { ResourceDef } from '../resources/types'
import { friendlyError, useLookupIndexes } from '../resources/useLookups'
import { downloadCsv, importableFields, parseImport, templateCsv, type ParseResult } from './csv'

type Outcome = { line: number; ok: boolean; message?: string }

export function CsvImport({ resource, onClose }: { resource: ResourceDef; onClose: () => void }) {
  const qc = useQueryClient()
  const { indexes, loading } = useLookupIndexes(importableFields(resource))
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null)

  const valid = parsed?.rows.filter((r) => r.errors.length === 0) ?? []
  const invalid = parsed?.rows.filter((r) => r.errors.length > 0) ?? []
  const blocked = !parsed || parsed.fileErrors.some((e) => e.startsWith('Missing required'))

  async function onFile(file: File) {
    setFileName(file.name); setOutcomes(null)
    setParsed(parseImport(await file.text(), resource, indexes))
  }

  async function run() {
    setRunning(true); setProgress(0)
    const results: Outcome[] = []
    // One row at a time: volumes are small, and each failure gets its own message.
    for (const [i, r] of valid.entries()) {
      const { error } = await db.from(resource.table).insert(r.values)
      results.push({ line: r.line, ok: !error, message: error ? friendlyError(error) : undefined })
      setProgress(i + 1)
    }
    setOutcomes(results)
    setRunning(false)
    await qc.invalidateQueries({ queryKey: ['resource', resource.table] })
    await qc.invalidateQueries({ queryKey: ['lookup'] })
  }

  function errorReport() {
    const lines = [
      ...invalid.map((r) => [r.line, r.errors.join('; ')]),
      ...(outcomes ?? []).filter((o) => !o.ok).map((o) => [o.line, o.message ?? '']),
    ].sort((a, b) => Number(a[0]) - Number(b[0]))
    downloadCsv(`${resource.key}-import-errors.csv`, Papa.unparse([['Line', 'Problem'], ...lines]))
  }

  const failed = outcomes?.filter((o) => !o.ok) ?? []

  return (
    <div className="csv-import">
      <p className="muted">
        Fill in the <button className="link" onClick={() => downloadCsv(`${resource.key}-template.csv`, templateCsv(resource))}>CSV template</button>{' '}
        (columns marked * are required; dates as DD/MM/YYYY; names must match existing records exactly). Nothing is saved until you press Import.
      </p>

      {!outcomes && (
        <label className="file-picker">
          <input type="file" accept=".csv,text/csv" disabled={loading || running}
                 onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {loading ? 'Loading lists…' : fileName ?? 'Choose a CSV file'}
        </label>
      )}

      {parsed && !outcomes && (
        <>
          {parsed.fileErrors.map((e) => <p key={e} className="form-error">{e}</p>)}
          {parsed.mapping.unknownHeaders.length > 0 && (
            <p className="muted small">Ignored columns: {parsed.mapping.unknownHeaders.join(', ')}</p>
          )}
          <p><strong>{valid.length}</strong> row{valid.length === 1 ? '' : 's'} ready, <strong>{invalid.length}</strong> with problems.</p>
          {invalid.length > 0 && (
            <table className="compact">
              <thead><tr><th>Line</th><th>Problem</th></tr></thead>
              <tbody>
                {invalid.slice(0, 50).map((r) => <tr key={r.line}><td>{r.line}</td><td>{r.errors.join('; ')}</td></tr>)}
              </tbody>
            </table>
          )}
          <div className="form-actions">
            <button className="primary" disabled={blocked || running || valid.length === 0} onClick={run}>
              {running ? `Importing ${progress} of ${valid.length}…` : `Import ${valid.length} row${valid.length === 1 ? '' : 's'}`}
            </button>
            {invalid.length > 0 && <button onClick={errorReport}>Download problems</button>}
            <button onClick={onClose} disabled={running}>Cancel</button>
          </div>
        </>
      )}

      {outcomes && (
        <>
          <p><strong>{outcomes.length - failed.length}</strong> imported{failed.length > 0 && <>, <strong>{failed.length}</strong> rejected by the database</>}{invalid.length > 0 && <>, <strong>{invalid.length}</strong> skipped with problems</>}.</p>
          {failed.length > 0 && (
            <table className="compact">
              <thead><tr><th>Line</th><th>Rejected because</th></tr></thead>
              <tbody>{failed.map((o) => <tr key={o.line}><td>{o.line}</td><td>{o.message}</td></tr>)}</tbody>
            </table>
          )}
          <div className="form-actions">
            {(failed.length > 0 || invalid.length > 0) && <button onClick={errorReport}>Download problems</button>}
            <button className="primary" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </div>
  )
}
