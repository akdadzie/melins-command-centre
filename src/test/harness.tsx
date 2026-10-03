// Test harness for whole screens: an in-memory stand-in for the Supabase
// client (filters, insert, update, rpc), and helpers to render a route and
// drive it the way a person would. Used with vi.mock('../lib/supabase').
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'

type Row = Record<string, unknown>
type Filter = (r: Row) => boolean

export interface FakeDb {
  tables: Record<string, Row[]>
  rpcs: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>
  /** Runs before an insert is stored, like a database trigger (fills defaults, can throw). */
  beforeInsert: Record<string, (row: Row) => Row>
  writes: { table: string; op: string; payload: unknown }[]
}

export function createFakeDb(init: Partial<FakeDb> = {}): FakeDb {
  return { tables: {}, rpcs: {}, beforeInsert: {}, writes: [], ...init }
}

let seq = 0
export const fakeId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

/** A chainable query builder resolving like supabase-js: { data, error }. */
export function fakeClient(db: FakeDb) {
  function from(table: string) {
    const filters: Filter[] = []
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
    let payload: unknown = null
    let single: null | 'one' | 'maybe' = null
    let head = false
    const rows = () => (db.tables[table] ??= [])
    const run = () => {
      try {
        let result: Row[]
        if (op === 'insert' || op === 'upsert') {
          const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
          result = items.map((it) => {
            const row = (db.beforeInsert[table] ?? ((r) => r))({ id: fakeId(), ...it })
            rows().push(row)
            return row
          })
        } else if (op === 'update') {
          result = rows().filter((r) => filters.every((f) => f(r)))
          result.forEach((r) => Object.assign(r, payload as Row))
        } else if (op === 'delete') {
          result = rows().filter((r) => filters.every((f) => f(r)))
          db.tables[table] = rows().filter((r) => !result.includes(r))
        } else {
          result = rows().filter((r) => filters.every((f) => f(r)))
        }
        if (op !== 'select') db.writes.push({ table, op, payload })
        if (head) return { data: null, count: result.length, error: null }
        if (single) {
          if (single === 'one' && result.length !== 1) return { data: null, error: { message: `expected one row from ${table}` } }
          return { data: result[0] ? { ...result[0] } : null, error: null }
        }
        return { data: result.map((r) => ({ ...r })), error: null }
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } }
      }
    }
    const b = {
      select: (_cols?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return b },
      insert: (p: unknown) => { op = 'insert'; payload = p; return b },
      upsert: (p: unknown) => { op = 'upsert'; payload = p; return b },
      update: (p: unknown) => { op = 'update'; payload = p; return b },
      delete: () => { op = 'delete'; return b },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b },
      gt: (c: string, v: never) => { filters.push((r) => (r[c] as never) > v); return b },
      gte: (c: string, v: never) => { filters.push((r) => (r[c] as never) >= v); return b },
      lt: (c: string, v: never) => { filters.push((r) => (r[c] as never) < v); return b },
      lte: (c: string, v: never) => { filters.push((r) => (r[c] as never) <= v); return b },
      match: (m: Row) => { for (const [c, v] of Object.entries(m)) filters.push((r) => r[c] === v); return b },
      or: () => b, order: () => b, limit: () => b, range: () => b,
      maybeSingle: () => { single = 'maybe'; return b },
      single: () => { single = 'one'; return b },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    }
    return b
  }
  return {
    from,
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const r = db.rpcs[name]
      return { data: typeof r === 'function' ? (r as (a: Record<string, unknown>) => unknown)(args) : r ?? null, error: null }
    },
    auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: '#' }, error: null }) }) },
  }
}

// ---------------------------------------------------------------------------
// Rendering and interaction
// ---------------------------------------------------------------------------
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no modal dialogs.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
}

export interface Screen {
  container: HTMLElement
  root: Root
  /** Errors React couldn't recover from: the cause of a blank screen. */
  crashes: Error[]
  unmount: () => void
}

export async function renderRoutes(routes: Record<string, ReactNode>, at: string): Promise<Screen> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const crashes: Error[] = []
  const root = createRoot(container, { onUncaughtError: (e) => { crashes.push(e as Error) } })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>
          <Routes>{Object.entries(routes).map(([path, el]) => <Route key={path} path={path} element={el} />)}</Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  await settle()
  return { container, root, crashes, unmount: () => { act(() => root.unmount()); container.remove() } }
}

/** Lets queries resolve and React re-render. */
export async function settle(times = 5) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

export function byText(root: ParentNode, selector: string, text: string | RegExp): HTMLElement {
  const el = [...root.querySelectorAll<HTMLElement>(selector)].find((e) =>
    typeof text === 'string' ? e.textContent?.trim() === text : text.test(e.textContent ?? ''))
  if (!el) throw new Error(`No ${selector} with text ${text}`)
  return el
}

export async function click(el: Element) {
  await act(async () => { (el as HTMLElement).click() })
  await settle()
}

/** Types into an input or picks a select option, firing the events React listens to. */
export async function type(el: Element, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
    : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  await act(async () => {
    setter.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

export async function submit(form: Element) {
  await act(async () => { (form as HTMLFormElement).requestSubmit() })
  await settle()
}
