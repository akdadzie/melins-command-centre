import type { ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { useAuth } from './auth/AuthProvider'
import { AuthGate } from './auth/AuthScreens'
import { Layout } from './components/Layout'
import { ComingSoon, InProgress, NoAccess, NotFound } from './components/Placeholders'
import { ImportExportPage } from './pages/ImportExportPage'
import { MyProfile } from './pages/MyProfile'
import { InvoiceDetail } from './features/invoices/InvoiceDetail'
import { InvoicesPage } from './features/invoices/InvoicesPage'
import { NewReceiptFromStatement, ReceiptsPage } from './features/receipts/ReceiptsPage'
import { Home, MyJobs, SettingsPage, StaffPage } from './pages/SimplePages'
import * as R from './resources/definitions'
import { ResourceList } from './resources/ResourceList'
import { ROUTES, canOpen, type RouteDef } from './routes/routeTable'

/** Screens built so far. Everything else in ROUTES shows its placeholder. */
const SCREENS: Record<string, () => ReactNode> = {
  '/': () => <Home />,
  '/import': () => <ImportExportPage />,
  '/me': () => <MyProfile />,
  '/invoices': () => <InvoicesPage />,
  '/invoices/:number': () => <InvoiceDetail />,
  '/receipts': () => <ReceiptsPage />,
  '/receipts/new': () => <NewReceiptFromStatement />,
  '/receipts/wht': () => <ResourceList resource={R.whtCertificates} />,
  '/settings': () => <SettingsPage />,
  '/accounts': () => <ResourceList resource={R.accounts} />,
  '/accounts/transfers': () => <ResourceList resource={R.transfers} />,
  '/clients': () => <ResourceList resource={R.clients} />,
  '/referrers': () => <ResourceList resource={R.referrers} />,
  '/suppliers': () => <ResourceList resource={R.suppliers} />,
  '/expenses': () => <ResourceList resource={R.expenses} />,
  '/expenses/recurring': () => <ResourceList resource={R.recurringExpenses} />,
  '/staff-loans': () => <ResourceList resource={R.staffLoans} />,
  '/tax/statutory': () => <ResourceList resource={R.statutoryLines} />,
  '/directors': () => <ResourceList resource={R.directorTransactions} />,
  '/leave/balances': () => <ResourceList resource={R.leaveEntitlements} />,
  '/team/staff': () => <StaffPage />,
}

function Guarded({ route }: { route: RouteDef }) {
  const { role } = useAuth()
  if (!canOpen(route, role)) return <NoAccess />
  if (route.phase !== 'A') return <ComingSoon title={route.title} phase={route.phase} />
  if (route.path === '/jobs') return role === 'staff' ? <MyJobs /> : <ResourceList resource={R.jobs} />
  const screen = SCREENS[route.path]
  return screen ? <>{screen()}</> : <InProgress title={route.title} />
}

export function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Layout>
          <Routes>
            {ROUTES.map((r) => <Route key={r.path} path={r.path} element={<Guarded route={r} />} />)}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </AuthGate>
    </BrowserRouter>
  )
}
