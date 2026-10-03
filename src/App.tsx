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
import { ClientDetail, DirectorDetail, DirectorPaymentsPage, DirectorsPage, ReferrerDetail } from './features/records/DetailPages'
import { TeamPage } from './features/team/TeamPage'
import { ActivityReportPage } from './features/team/ActivityReport'
import { VatWorkingsPage } from './features/tax/VatWorkingsPage'
import { AdjustmentsPage, ReadyToInvoicePage, RetentionPage } from './features/invoices/InvoiceListsPages'
import { NewReceiptFromStatement, ReceiptsPage } from './features/receipts/ReceiptsPage'
import { MyPayslips, PayrollPage, PayrollRunPage, PayslipView } from './features/payroll/PayrollPages'
import { TimesheetApprovalsPage, TimesheetPage } from './features/timesheet/TimesheetPage'
import { AccountDetail, AccountsPage, ReconciliationsPage } from './features/accounts/AccountsPages'
import { CloseRedirect, MonthClosePage } from './features/close/MonthClosePage'
import { JobDetail } from './features/jobs/JobDetail'
import { LeaveBalancesPage, LeaveCalendarPage, LeaveRequestsPage, MyLeavePage } from './features/leave/LeavePages'
import { ExpensesPage, PaymentsOutPage, StaffPaymentsPage, StatutoryPage } from './features/payouts/PayoutPages'
import { Home } from './features/home/HomePages'
import { MonthlySummaryPage, NotificationsPage } from './features/home/SummaryPages'
import { MyJobs, StaffPage } from './pages/SimplePages'
import { SettingsPage } from './features/settings/SettingsPages'
import * as R from './resources/definitions'
import { ResourceList } from './resources/ResourceList'
import { ROUTES, canOpen, type RouteDef } from './routes/routeTable'

/** Screens built so far. Everything else in ROUTES shows its placeholder. */
const SCREENS: Record<string, () => ReactNode> = {
  '/': () => <Home />,
  '/notifications': () => <NotificationsPage />,
  '/reports/monthly': () => <MonthlySummaryPage />,
  '/import': () => <ImportExportPage />,
  '/me': () => <MyProfile />,
  '/invoices': () => <InvoicesPage />,
  '/invoices/:number': () => <InvoiceDetail />,
  '/invoices/ready': () => <ReadyToInvoicePage />,
  '/tax/vat/:month': () => <VatWorkingsPage />,
  '/invoices/retention': () => <RetentionPage />,
  '/invoices/adjustments': () => <AdjustmentsPage />,
  '/receipts': () => <ReceiptsPage />,
  '/receipts/new': () => <NewReceiptFromStatement />,
  '/receipts/wht': () => <ResourceList resource={R.whtCertificates} />,
  '/settings': () => <SettingsPage />,
  '/accounts': () => <AccountsPage />,
  '/accounts/:id': () => <AccountDetail />,
  '/accounts/reconciliations': () => <ReconciliationsPage />,
  '/accounts/transfers': () => <ResourceList resource={R.transfers} />,
  '/clients': () => <ResourceList resource={R.clients} />,
  '/referrers': () => <ResourceList resource={R.referrers} />,
  '/suppliers': () => <ResourceList resource={R.suppliers} />,
  '/expenses': () => <ExpensesPage />,
  '/payments-out': () => <PaymentsOutPage />,
  '/staff-payments': () => <StaffPaymentsPage />,
  '/payroll': () => <PayrollPage />,
  '/payroll/:month': () => <PayrollRunPage />,
  '/me/payslips': () => <MyPayslips />,
  '/me/payslips/:id': () => <PayslipView />,
  '/timesheet': () => <TimesheetPage />,
  '/timesheet/approvals': () => <TimesheetApprovalsPage />,
  '/expenses/recurring': () => <ResourceList resource={R.recurringExpenses} />,
  '/staff-loans': () => <ResourceList resource={R.staffLoans} />,
  '/tax/statutory': () => <StatutoryPage />,
  '/directors': () => <DirectorsPage />,
  '/directors/payments': () => <DirectorPaymentsPage />,
  '/directors/:id': () => <DirectorDetail />,
  '/clients/:id': () => <ClientDetail />,
  '/referrers/:id': () => <ReferrerDetail />,
  '/jobs/:number': () => <JobDetail />,
  '/close': () => <CloseRedirect />,
  '/close/:month': () => <MonthClosePage />,
  '/me/leave': () => <MyLeavePage />,
  '/leave': () => <LeaveRequestsPage />,
  '/leave/calendar': () => <LeaveCalendarPage />,
  '/leave/balances': () => <LeaveBalancesPage />,
  '/team': () => <TeamPage />,
  '/team/activities': () => <ActivityReportPage />,
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
