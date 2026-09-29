import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { ROLE_LABELS } from '../auth/roles'
import { appEnv } from '../lib/supabase'
import { ROUTES, canOpen, type RouteDef } from '../routes/routeTable'

const GROUPS: NonNullable<RouteDef['nav']>[] = ['Money', 'Work', 'People', 'Records', 'Admin']

export function Layout({ children }: { children: ReactNode }) {
  const { profile, role, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const visible = ROUTES.filter((r) => r.nav && canOpen(r, role))

  return (
    <div className="shell">
      {appEnv !== 'production' && <div className="env-banner">STAGING: test data only</div>}
      <header className="topbar">
        <button className="icon menu-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
        <NavLink to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="wordmark">MeLiNS</span>
          <span className="brand-sub">Command Centre</span>
        </NavLink>
        <div className="topbar-right">
          <NavLink to="/notifications" className="icon" aria-label="Notifications">🔔</NavLink>
          <NavLink to="/me" className="user">{profile?.full_name}<span className="role">{role ? ROLE_LABELS[role] : ''}</span></NavLink>
          <button className="link" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <div className="body">
        <nav className={`sidenav${open ? ' open' : ''}`} key={location.pathname} onClick={() => setOpen(false)}>
          <NavLink to="/" end>Home</NavLink>
          {GROUPS.map((g) => {
            const items = visible.filter((r) => r.nav === g)
            if (items.length === 0) return null
            return (
              <div key={g} className="nav-group">
                <h3>{g}</h3>
                {items.map((r) => (
                  <NavLink key={r.path} to={r.path} end className={r.phase !== 'A' ? 'later' : undefined}>
                    {r.title}{r.phase !== 'A' && <span className="phase-tag">{r.phase}</span>}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
