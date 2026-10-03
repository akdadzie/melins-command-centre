import { afterEach, describe, expect, it, vi } from 'vitest'
import { Link, Outlet, Route, Routes, useLocation } from 'react-router'
import { byText, click, renderRoutes, type Screen } from '../test/harness'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never { throw new Error('fee is not a number') }

/** Like the layout: a menu outside the boundary, the screen inside it. */
function Shell() {
  const location = useLocation()
  return <><nav><Link to="/fine">Fine page</Link></nav><ErrorBoundary resetKey={location.pathname}><Outlet /></ErrorBoundary></>
}

let screen: Screen | null = null
afterEach(() => { screen?.unmount(); screen = null; vi.restoreAllMocks() })

describe('error boundary (A-047)', () => {
  it('shows "Something went wrong" with a reload button instead of a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    screen = await renderRoutes({ '/boom': <ErrorBoundary><Boom /></ErrorBoundary> }, '/boom')
    expect(screen.crashes).toEqual([])
    expect(screen.container.querySelector('h1')?.textContent).toBe('Something went wrong')
    expect(byText(screen.container, 'button', 'Reload')).toBeTruthy()
    expect(screen.container.textContent).toContain('fee is not a number')
  })

  it('keeps the menu working and recovers on the next page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    screen = await renderRoutes({
      '/*': <Routes><Route element={<Shell />}><Route path="boom" element={<Boom />} /><Route path="fine" element={<p>All good</p>} /></Route></Routes>,
    }, '/boom')
    expect(screen.container.textContent).toContain('Something went wrong')
    await click(byText(screen.container, 'a', 'Fine page'))
    expect(screen.container.textContent).toContain('All good')
    expect(screen.container.textContent).not.toContain('Something went wrong')
  })
})
