import { useEffect, useRef, type ReactNode } from 'react'

/** Accessible modal built on <dialog>; full-screen on phones via CSS. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    d?.showModal()
    return () => d?.close()
  }, [])
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onClose() }} aria-labelledby="dialog-title">
      <header>
        <h2 id="dialog-title">{title}</h2>
        <button className="icon" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  )
}
