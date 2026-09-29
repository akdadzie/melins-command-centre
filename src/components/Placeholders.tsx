import { Link } from 'react-router'

/** Shown for any route the role may not open (brief §3). The database returns nothing either. */
export function NoAccess() {
  return (
    <section className="notice">
      <h1>No access</h1>
      <p>Your role can't open this page. If you think it should, ask the Managing Director.</p>
      <Link to="/">Go to your home screen</Link>
    </section>
  )
}

/** Phase B and C routes exist now but aren't built yet (A-006). */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <section className="notice">
      <h1>{title}</h1>
      <p>Coming in Phase {phase}.</p>
    </section>
  )
}

/** Phase A screens that come in the next build steps (list/detail views, home screens). */
export function InProgress({ title }: { title: string }) {
  return (
    <section className="notice">
      <h1>{title}</h1>
      <p>This Phase A screen is being built next.</p>
    </section>
  )
}

export function NotFound() {
  return (
    <section className="notice">
      <h1>Page not found</h1>
      <Link to="/">Go to your home screen</Link>
    </section>
  )
}
