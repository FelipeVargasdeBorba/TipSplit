import { useEffect, useMemo, useState } from 'react'
import './styles/app.css'
import './styles/cash-inventory.css'
import './styles/auth.css'
import type { Session, User } from '@supabase/supabase-js'
import type { FormEvent } from 'react'
import { supabase, supabaseConfigured, TIPSPLIT_WORKSPACE_ID } from './lib/supabaseClient'
import {
  createCloudEmployee,
  createCloudTipRecord,
  deleteCloudEmployee,
  deleteCloudTipRecord,
  getWorkspaceRole,
  loadWorkspaceSnapshot,
  migrateLocalDataIfWorkspaceEmpty,
  subscribeToWorkspaceChanges,
  type WorkspaceRole,
} from './cloud/tipSplitCloud'
import {
  CASH_DENOMINATIONS,
  createEmptyDenominationCounts,
  sumDenominationsCents,
  type CashDenominationCounts,
  type CashDenominationId,
} from './cash/denominations'
import {
  allocateCashByDenominations,
  type CashDistribution,
} from './cash/allocateCashByDenominations'
import {
  calculateTipAllocation,
  CLOSING_WEIGHT_MULTIPLIER,
} from './calculations/calculateTipAllocation'
import {
  loadEmployees,
  loadTipRecords,
  type StoredEmployee,
  type TipRecord,
} from './storage/tipRecords'

type Employee = {
  id: string
  name: string
}

type Allocation = {
  id: string
  amount: number
}

const initialEmployees: Employee[] = [
  { id: '1', name: 'Employee 1' },
  { id: '2', name: 'Employee 2' },
  { id: '3', name: 'Employee 3' },
  { id: '4', name: 'Employee 4' },
]

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100)
}

function getLocalDateString(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-IE', {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`))
}

function formatDifference(cents: number): string {
  if (cents === 0) return formatMoney(0)
  return `${cents > 0 ? '+' : '−'}${formatMoney(Math.abs(cents))}`
}

function describeDifference(cents: number): string {
  if (cents === 0) return 'Exact amount'
  return cents > 0
    ? `Overpaid by ${formatMoney(cents)}`
    : `Underpaid by ${formatMoney(Math.abs(cents))}`
}

function formatDenominationBreakdown(counts: CashDenominationCounts): string {
  return CASH_DENOMINATIONS
    .filter((denomination) => counts[denomination.id] > 0)
    .map((denomination) => `${denomination.shortLabel} × ${counts[denomination.id]}`)
    .join(', ')
}

type DashboardProps = {
  user: User
  workspaceId: string
  role: WorkspaceRole
  onSignOut: () => Promise<void>
}

function TipSplitDashboard({ user, workspaceId, role, onSignOut }: DashboardProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [records, setRecords] = useState<TipRecord[]>([])
  const [currentView, setCurrentView] = useState<'dashboard' | 'history' | 'settings'>('dashboard')
  const [recordDate, setRecordDate] = useState(() => getLocalDateString())
  const [workedIds, setWorkedIds] = useState<string[]>(() => loadEmployees(initialEmployees).map((employee) => employee.id))
  const [closingIds, setClosingIds] = useState<string[]>([])
  const [newEmployeeName, setNewEmployeeName] = useState('')
  const [notice, setNotice] = useState('')
  const [cashInventory, setCashInventory] = useState<CashDenominationCounts>(() => createEmptyDenominationCounts())
  const [dataLoading, setDataLoading] = useState(true)
  const [dataLoadError, setDataLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function initialiseWorkspace() {
      setDataLoading(true)
      setDataLoadError('')
      try {
        const localEmployees: StoredEmployee[] = loadEmployees(initialEmployees)
        const localRecords = loadTipRecords()
        const result = await migrateLocalDataIfWorkspaceEmpty(workspaceId, user, localEmployees, localRecords, role)
        if (cancelled) return
        setEmployees(result.snapshot.employees)
        setRecords(result.snapshot.records)
        setWorkedIds(result.snapshot.employees.map((employee) => employee.id))
        if (result.migratedEmployees > 0 || result.migratedRecords > 0) {
          setNotice(`Imported ${result.migratedEmployees} employee(s) and ${result.migratedRecords} historical record(s) from this browser into the shared workspace.`)
        }
      } catch (error) {
        if (!cancelled) setDataLoadError(error instanceof Error ? error.message : 'Could not load the shared workspace.')
      } finally {
        if (!cancelled) setDataLoading(false)
      }
    }
    void initialiseWorkspace()
    return () => { cancelled = true }
  }, [workspaceId, user, role])

  useEffect(() => {
    if (dataLoading || dataLoadError || !supabase) return
    let active = true
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const snapshot = await loadWorkspaceSnapshot(workspaceId)
        if (active) {
          setEmployees(snapshot.employees)
          setRecords(snapshot.records)
        }
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : 'Could not refresh shared data.')
      } finally {
        refreshing = false
      }
    }
    const channel = subscribeToWorkspaceChanges(workspaceId, () => { void refresh() })
    const intervalId = window.setInterval(() => { void refresh() }, 20000)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refresh)
      if (supabase) void supabase.removeChannel(channel)
    }
  }, [dataLoading, dataLoadError, workspaceId])

  const totalCents = useMemo(() => {
    try {
      return sumDenominationsCents(cashInventory)
    } catch {
      return null
    }
  }, [cashInventory])

  const allocations: Allocation[] = useMemo(() => {
    if (totalCents === null || workedIds.length === 0) return []

    try {
      return calculateTipAllocation(totalCents, workedIds, closingIds).map((share) => ({
        id: share.employeeId,
        amount: share.cents,
      }))
    } catch {
      return []
    }
  }, [totalCents, workedIds, closingIds])

  const allocatedTotal = allocations.reduce((sum, allocation) => sum + allocation.amount, 0)

  const cashDistribution: CashDistribution | null = useMemo(() => {
    if (totalCents === null || allocations.length !== workedIds.length) return null

    try {
      return allocateCashByDenominations(
        cashInventory,
        allocations.map((allocation) => ({ employeeId: allocation.id, cents: allocation.amount })),
      )
    } catch {
      return null
    }
  }, [totalCents, allocations, workedIds.length, cashInventory])

  const cashPayments = useMemo(() => {
    if (!cashDistribution) return []

    return cashDistribution.employees.map((payout) => ({
      id: payout.employeeId,
      employeeName: employees.find((employee) => employee.id === payout.employeeId)?.name ?? 'Unknown employee',
      amount: payout.targetCents,
      deliveredCents: payout.paidCents,
      differenceCents: payout.paidCents - payout.targetCents,
      denominations: payout.denominations,
    }))
  }, [cashDistribution, employees])

  const deliveredTotal = cashDistribution?.distributedCents ?? 0
  const leftoverCents = cashDistribution?.leftoverCents ?? totalCents ?? 0

  function updateCashInventoryCount(denominationId: CashDenominationId, rawValue: string) {
    const parsed = rawValue.trim() === '' ? 0 : Number(rawValue)
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      setNotice('Cash counts must be non-negative whole numbers.')
      return
    }

    setCashInventory((current) => ({ ...current, [denominationId]: parsed }))
    setNotice('')
  }

  function toggleWorked(employeeId: string) {
    if (workedIds.includes(employeeId)) {
      setWorkedIds((current) => current.filter((id) => id !== employeeId))
      setClosingIds((current) => current.filter((id) => id !== employeeId))
    } else {
      setWorkedIds((current) => current.includes(employeeId) ? current : [...current, employeeId])
    }
    setNotice('')
  }

  function toggleClosing(employeeId: string) {
    if (!workedIds.includes(employeeId)) return
    setClosingIds((current) => current.includes(employeeId)
      ? current.filter((id) => id !== employeeId)
      : [...current, employeeId])
    setNotice('')
  }

  async function addEmployee() {
    const name = newEmployeeName.trim()
    if (!name) {
      setNotice('Enter an employee name first.')
      return
    }

    const employee: Employee = { id: crypto.randomUUID(), name }
    try {
      await createCloudEmployee(workspaceId, employee)
      setEmployees((current) => [...current, employee])
      setWorkedIds((current) => [...current, employee.id])
      setNewEmployeeName('')
      setNotice(`${name} added to the shared team.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add employee.')
    }
  }

  async function removeEmployee(employeeId: string) {
    const employee = employees.find((item) => item.id === employeeId)
    try {
      await deleteCloudEmployee(workspaceId, employeeId)
      setEmployees((current) => current.filter((item) => item.id !== employeeId))
      setWorkedIds((current) => current.filter((id) => id !== employeeId))
      setClosingIds((current) => current.filter((id) => id !== employeeId))
      setNotice(employee ? `${employee.name} removed from the shared team.` : 'Employee removed.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not remove employee.')
    }
  }

  async function saveDay() {
    if (totalCents === null) {
      setNotice('Check the cash denomination counts. One or more counts are invalid or too large.')
      return
    }
    if (!recordDate) {
      setNotice('Choose the business date for this distribution.')
      return
    }
    if (workedIds.length === 0) {
      setNotice('Select at least one employee who worked.')
      return
    }
    if (records.some((record) => record.date === recordDate)) {
      setNotice('A record already exists for this date. Open History and delete it first if you need to replace it.')
      return
    }
    if (!cashDistribution || cashPayments.length !== workedIds.length) {
      setNotice('Could not calculate the physical cash allocation. Check the inventory counts and try again.')
      return
    }

    try {
      const shares = calculateTipAllocation(totalCents, workedIds, closingIds)
      const payoutsById = new Map(cashDistribution.employees.map((payout) => [payout.employeeId, payout]))
      const record: TipRecord = {
        id: crypto.randomUUID(),
        date: recordDate,
        createdAt: new Date().toISOString(),
        totalCents,
        employees: shares.map((share) => {
          const employee = employees.find((item) => item.id === share.employeeId)
          const payout = payoutsById.get(share.employeeId)
          if (!payout) throw new Error(`Missing physical payout for ${share.employeeId}.`)
          return {
            employeeId: share.employeeId,
            employeeName: employee?.name ?? 'Unknown employee',
            cents: share.cents,
            closing: closingIds.includes(share.employeeId),
            denominations: { ...payout.denominations },
            deliveredCents: payout.paidCents,
          }
        }),
        sourceDenominations: { ...cashInventory },
        leftoverDenominations: { ...cashDistribution.leftoverDenominations },
        leftoverCents: cashDistribution.leftoverCents,
      }

      await createCloudTipRecord(workspaceId, user, record)
      setRecords((current) => [...current, record].sort((a, b) => b.date.localeCompare(a.date)))
      setCashInventory(createEmptyDenominationCounts())
      setNotice(
        cashDistribution.leftoverCents > 0
          ? `Distribution saved for ${formatDate(recordDate)}. ${formatMoney(cashDistribution.leftoverCents)} remains with the supervisor.`
          : `Distribution saved for ${formatDate(recordDate)}. All counted cash has been allocated.`,
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this distribution. Please try again.')
    }
  }

  async function deleteRecord(recordId: string) {
    const record = records.find((item) => item.id === recordId)
    if (!record) return

    const confirmed = window.confirm(`Delete the tip record for ${formatDate(record.date)}? This cannot be undone.`)
    if (!confirmed) return

    try {
      await deleteCloudTipRecord(workspaceId, recordId)
      setRecords((current) => current.filter((item) => item.id !== recordId))
      setNotice(`Record for ${formatDate(record.date)} deleted from the shared history.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete the record.')
    }
  }

  const noteDenominations = CASH_DENOMINATIONS.filter((denomination) => denomination.kind === 'note')
  const coinDenominations = CASH_DENOMINATIONS.filter((denomination) => denomination.kind === 'coin')

  if (dataLoading) {
    return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">T</div><p className="eyebrow">SHARED WORKSPACE</p><h1>Loading TipSplit</h1><p>Connecting securely and loading your team's shared records…</p></section></main>
  }

  if (dataLoadError) {
    return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">T</div><p className="eyebrow">WORKSPACE ERROR</p><h1>Could not load TipSplit</h1><p className="auth-error">{dataLoadError}</p><p>Check the SQL setup, workspace ID, and your workspace membership before retrying.</p><button className="primary-button" type="button" onClick={() => window.location.reload()}>Retry connection</button><button className="auth-secondary-button" type="button" onClick={() => { void onSignOut() }}>Sign out</button></section></main>
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div><h1>TipSplit</h1><p>Cash management</p></div>
        </div>

        <div className="sidebar-label">WORKSPACE</div>
        <nav className="navigation">
          <button className={`nav-item ${currentView === 'dashboard' ? 'active' : ''}`} type="button" onClick={() => { setCurrentView('dashboard'); setNotice('') }}>
            <span>▦</span> Dashboard
          </button>
          <button className={`nav-item ${currentView === 'history' ? 'active' : ''}`} type="button" onClick={() => { setCurrentView('history'); setNotice('') }}>
            <span>◷</span> History
          </button>
          <button className={`nav-item ${currentView === 'settings' ? 'active' : ''}`} type="button" onClick={() => { setCurrentView('settings'); setNotice('') }}>
            <span>⚙</span> Settings
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="status-dot" />
          <div><strong>Cash tips</strong><p>Euro · EUR</p></div>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">CAFÉ EN SEINE</p>
            <h2>{currentView === 'dashboard' ? 'Tips dashboard' : currentView === 'history' ? 'Distribution history' : 'Settings'}</h2>
          </div>
          <div className="admin-chip">
            <div className="avatar">{(user.email ?? 'U').charAt(0).toUpperCase()}</div>
            <div><strong>{user.email ?? 'Signed-in user'}</strong><p>{role === 'admin' ? 'Workspace admin' : 'Supervisor'}</p></div>
            <button className="signout-button" type="button" onClick={() => { void onSignOut() }}>Sign out</button>
          </div>
        </header>

        {currentView === 'dashboard' ? (
          <>
            <section className="welcome-section">
              <div>
                <p className="eyebrow">DAILY OPERATIONS</p>
                <h2>Let’s split the tips.</h2>
                <p className="welcome-description">Count the cash first. TipSplit will calculate each share, suggest which notes and coins to hand out.</p>
              </div>
              <div className="welcome-icon">€</div>
            </section>

            <section className="panel cash-inventory-panel">
              <div className="panel-header">
                <div><p className="eyebrow">STEP 1 · CASH INVENTORY</p><h3>How much cash is available?</h3></div>
                <span className="count-badge">Live total</span>
              </div>
              <p className="inventory-intro">Enter the number of each note and coin available for tips. The total is calculated automatically; you no longer need to type the total in euros.</p>

              <div className="denomination-section-label">Banknotes</div>
              <div className="denomination-grid">
                {noteDenominations.map((denomination) => (
                  <label className="denomination-field" key={denomination.id}>
                    <span>{denomination.shortLabel}</span>
                    <input
                      type="number" min="0" step="1" inputMode="numeric"
                      aria-label={`Number of ${denomination.label}s available`}
                      value={cashInventory[denomination.id]}
                      onChange={(event) => updateCashInventoryCount(denomination.id, event.target.value)}
                    />
                  </label>
                ))}
              </div>

              <div className="denomination-section-label">Coins</div>
              <div className="denomination-grid">
                {coinDenominations.map((denomination) => (
                  <label className="denomination-field" key={denomination.id}>
                    <span>{denomination.shortLabel}</span>
                    <input
                      type="number" min="0" step="1" inputMode="numeric"
                      aria-label={`Number of ${denomination.label}s available`}
                      value={cashInventory[denomination.id]}
                      onChange={(event) => updateCashInventoryCount(denomination.id, event.target.value)}
                    />
                  </label>
                ))}
              </div>

              <div className="cash-inventory-total">
                <div><span>Total counted</span><strong>{formatMoney(totalCents ?? 0)}</strong></div>
              </div>
            </section>

            <label className="field-label" htmlFor="record-date" style={{ display: 'block', margin: '0 0 0.4rem' }}>Business date</label>
            <input id="record-date" type="date" value={recordDate} onChange={(event) => { setRecordDate(event.target.value); setNotice('') }} required style={{ width: '100%', maxWidth: '280px', boxSizing: 'border-box', marginBottom: '1.2rem' }} />

            <div className="content-grid">
              <section className="panel team-panel">
                <div className="panel-header">
                  <div><p className="eyebrow">STEP 2 · YOUR PEOPLE</p><h3>Team members</h3></div>
                  <span className="count-badge">{employees.length} members</span>
                </div>

                {role === 'admin' ? (
                  <form className="add-employee-form" onSubmit={(event) => { event.preventDefault(); void addEmployee() }}>
                    <input aria-label="Employee name" placeholder="Add employee name..." value={newEmployeeName} onChange={(event) => setNewEmployeeName(event.target.value)} />
                    <button type="submit" className="add-button">+ Add</button>
                  </form>
                ) : <p className="panel-footnote">Only workspace admins can add or remove team members.</p>}

                <div className="employee-list">
                  {employees.map((employee) => {
                    const worked = workedIds.includes(employee.id)
                    const closing = closingIds.includes(employee.id)
                    return (
                      <article className="employee-row" key={employee.id}>
                        <div className="employee-avatar">{employee.name.charAt(0).toUpperCase()}</div>
                        <div className="employee-details"><strong>{employee.name}</strong><span>{worked ? 'Working today' : 'Not selected'}</span></div>
                        <label className="toggle-label"><input type="checkbox" checked={worked} onChange={() => toggleWorked(employee.id)} /><span>Worked</span></label>
                        <label className="toggle-label closing-toggle"><input type="checkbox" checked={closing} onChange={() => toggleClosing(employee.id)} disabled={!worked} /><span>Closing</span></label>
                        {role === 'admin' && <button className="remove-button" type="button" aria-label={`Remove ${employee.name}`} onClick={() => { void removeEmployee(employee.id) }}>×</button>}
                      </article>
                    )
                  })}
                  {employees.length === 0 && <div className="empty-state"><p>No team members yet.</p><span>Add an employee to get started.</span></div>}
                </div>

                <p className="panel-footnote">Closing employees receive a {CLOSING_WEIGHT_MULTIPLIER.toFixed(2)}× allocation weight, included in the same cash pool.</p>
              </section>

              <section className="panel distribution-panel">
                <div className="panel-header"><div><p className="eyebrow">STEP 3 · SUGGESTED PAYOUT</p><h3>Distribution preview</h3></div><span className="preview-badge">PREVIEW</span></div>

                <div className="distribution-summary">
                  <div><span>Employees receiving tips</span><strong>{allocations.length}</strong></div>
                  <div><span>Target shares total</span><strong>{formatMoney(allocatedTotal)}</strong></div>
                </div>

                <div className="allocation-list">
                  {cashPayments.map((payment) => (
                    <article className="cash-delivery-card" key={payment.id}>
                      <div className="cash-delivery-card-header">
                        <div><strong>{payment.employeeName}</strong><span>Target share: {formatMoney(payment.amount)}</span></div>
                        <div className="cash-paid-summary"><span>Suggested cash</span><strong>{formatMoney(payment.deliveredCents)}</strong></div>
                      </div>
                      <div className="payout-denomination-detail">
                        <span>Suggested notes and coins</span>
                        <p>{formatDenominationBreakdown(payment.denominations) || 'No cash unit can be assigned without exceeding this target.'}</p>
                      </div>
                    </article>
                  ))}
                  {allocations.length === 0 && <div className="empty-state"><p>No distribution to preview.</p><span>Count the cash and select employees who worked.</span></div>}
                </div>

                <section className="remainder-panel">
                  <div className="remainder-heading"><div><p className="eyebrow">SUPERVISOR DECISION</p><h4>Cash remaining</h4></div><strong>{formatMoney(leftoverCents)}</strong></div>
                  <div className="payout-denomination-detail"><span>Remaining notes and coins</span><p>{cashDistribution ? formatDenominationBreakdown(cashDistribution.leftoverDenominations) || 'No cash remains.' : 'Enter valid counts and select employees to calculate the remainder.'}</p></div>
                </section>

                <button className="primary-button" type="button" onClick={saveDay}>Save daily distribution <span>→</span></button>
                {notice && <div className="notice" role="status">{notice}</div>}
              </section>
            </div>
          </>
        ) : currentView === 'history' ? (
          <section aria-label="Saved distributions">
            <div className="panel" style={{ marginBottom: '1rem' }}>
              <div className="panel-header"><div><p className="eyebrow">SAVED RECORDS</p><h3>Distribution history</h3></div><span className="count-badge">{records.length} records</span></div>
              <p className="panel-footnote">These records are shared with authorized supervisors and are automatically deleted 30 days after they are saved.</p>
            </div>

            {records.length === 0 ? (
              <section className="panel empty-state"><p>No saved distributions yet.</p><span>Save a distribution from the Dashboard to see it here.</span><button className="add-button" type="button" style={{ marginTop: '1rem' }} onClick={() => setCurrentView('dashboard')}>Go to dashboard</button></section>
            ) : records.map((record) => {
              const hasInventoryRecord = record.sourceDenominations !== undefined && record.leftoverDenominations !== undefined && record.leftoverCents !== undefined
              return (
                <article className="panel" key={record.id} style={{ marginBottom: '1rem' }}>
                  <div className="panel-header" style={{ gap: '1rem', flexWrap: 'wrap' }}>
                    <div><p className="eyebrow">BUSINESS DATE</p><h3>{formatDate(record.date)}</h3></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}><div style={{ textAlign: 'right' }}><p className="eyebrow">TOTAL CASH COUNTED</p><strong style={{ fontSize: '1.25rem' }}>{formatMoney(record.totalCents)}</strong></div>{role === 'admin' && <button className="remove-button" type="button" aria-label={`Delete record for ${record.date}`} title="Delete this record" onClick={() => { void deleteRecord(record.id) }}>×</button>}</div>
                  </div>

                  {hasInventoryRecord && (
                    <div className="history-cash-inventory">
                      <p><strong>Starting inventory:</strong> {formatDenominationBreakdown(record.sourceDenominations!) || 'No cash recorded.'}</p>
                      <p><strong>Supervisor remainder:</strong> {formatMoney(record.leftoverCents!)} — {formatDenominationBreakdown(record.leftoverDenominations!) || 'No cash remained.'}</p>
                    </div>
                  )}

                  <div className="allocation-list">
                    {record.employees.map((employee) => {
                      const cashWasRecorded = employee.denominations !== undefined && employee.deliveredCents !== undefined
                      const difference = cashWasRecorded ? employee.deliveredCents! - employee.cents : null
                      const breakdown = cashWasRecorded ? formatDenominationBreakdown(employee.denominations!) : ''
                      return (
                        <div className="history-employee" key={employee.employeeId}>
                          <div className="allocation-row">
                            <div className="employee-avatar small">{employee.employeeName.charAt(0).toUpperCase()}</div>
                            <div className="allocation-name"><strong>{employee.employeeName}</strong><span>{employee.closing ? `Closing · ${CLOSING_WEIGHT_MULTIPLIER.toFixed(2)}× weight` : 'Regular shift · 1.00× weight'}</span></div>
                            <strong className="allocation-amount">Target {formatMoney(employee.cents)}</strong>
                          </div>
                          {cashWasRecorded ? (
                            <div className="history-cash-detail">
                              <span>{hasInventoryRecord ? 'Suggested payout' : 'Cash recorded as paid'}: <strong>{formatMoney(employee.deliveredCents!)}</strong></span>
                              {hasInventoryRecord ? (
                                difference === 0
                                  ? <span className="difference-exact">Exact target</span>
                                  : <span className="difference-alert">{formatMoney(Math.abs(difference!))} below target; remainder stayed with supervisor</span>
                              ) : (
                                <span className={difference === 0 ? 'difference-exact' : 'difference-alert'}>{describeDifference(difference!)} ({formatDifference(difference!)})</span>
                              )}
                              <details><summary>Notes and coins</summary><p>{breakdown || 'No notes or coins recorded.'}</p></details>
                            </div>
                          ) : <p className="panel-footnote">Cash denominations were not recorded for this older distribution.</p>}
                        </div>
                      )
                    })}
                  </div>
                </article>
              )
            })}
            {notice && <div className="notice" role="status">{notice}</div>}
          </section>
        ) : (
          <section className="panel" style={{ maxWidth: '760px' }}>
            <button className="add-button" type="button" onClick={() => { void onSignOut() }}>Sign out</button>
          </section>
        )}

        <footer className="page-footer"><span>TipSplit · Cash tip management</span><span>Built for fairer distribution</span></footer>
      </section>
    </main>
  )
}

function ConfigurationRequired() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">T</div>
        <p className="eyebrow">FIRST-TIME SETUP</p>
        <h1>Connect TipSplit</h1>
        <p>TipSplit now uses a shared database. Add your Supabase project details to a <code>.env.local</code> file in the project root, then restart the development server.</p>
        <div className="setup-code"><code>VITE_SUPABASE_URL=https://your-project.supabase.co<br />VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key<br />VITE_TIPSPLIT_WORKSPACE_ID=b4f4c574-6f44-4ed0-a9cd-a1c6f50fcd10</code></div>
        <p className="panel-footnote">For database setup and account permissions, follow the instructions in <code>README.md</code>. A fresh database uses <code>supabase/schema.sql</code>.</p>
      </section>
    </main>
  )
}

function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const normalizedEmail = email.trim().toLowerCase()
      if (mode === 'signup') {
        const { data, error: signupError } = await supabase.auth.signUp({ email: normalizedEmail, password })
        if (signupError) throw signupError
        if (!data.session) {
          setMessage('Account created. Check your email to confirm it, then sign in. A workspace admin must grant this account access before it can view café data.')
        } else {
          setMessage('Account created. If this is the first admin, finish the membership step in the setup instructions.')
        }
      } else {
        const { error: signinError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        if (signinError) throw signinError
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="brand-mark">T</div>
        <p className="eyebrow">CAFÉ EN SEINE · CASH MANAGEMENT</p>
        <h1>{mode === 'signin' ? 'Welcome back.' : 'Create your account.'}</h1>
        <p>{mode === 'signin' ? 'Sign in to access the shared TipSplit workspace.' : 'Create an account. A workspace admin must authorize it before you can see any café data.'}</p>
        <form className="auth-form" onSubmit={(event) => { void submit(event) }}>
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'} <span>→</span></button>
        </form>
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
        <button className="auth-secondary-button" type="button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setMessage('') }}>
          {mode === 'signin' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
        </button>
        <p className="panel-footnote">Only users explicitly added to this workspace can access team members and tip records. Admins manage the roster and can delete records; supervisors can create distributions and view history.</p>
      </section>
    </main>
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [role, setRole] = useState<WorkspaceRole | null>(null)
  const [membershipLoading, setMembershipLoading] = useState(false)
  const [membershipError, setMembershipError] = useState('')

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false)
      return
    }
    let mounted = true
    void supabase.auth.getSession().then(({ data, error }: { data: { session: Session | null }; error: { message: string } | null }) => {
      if (!mounted) return
      if (error) setMembershipError(error.message)
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, nextSession: Session | null) => {
      setSession(nextSession)
      setRole(null)
      setMembershipError('')
    })
    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !session) {
      setRole(null)
      setMembershipLoading(false)
      return
    }
    let cancelled = false
    setMembershipLoading(true)
    setMembershipError('')
    void getWorkspaceRole(TIPSPLIT_WORKSPACE_ID, session.user.id)
      .then((nextRole) => {
        if (!cancelled) setRole(nextRole)
      })
      .catch((error: unknown) => {
        if (!cancelled) setMembershipError(error instanceof Error ? error.message : 'Could not verify workspace access.')
      })
      .finally(() => {
        if (!cancelled) setMembershipLoading(false)
      })
    return () => { cancelled = true }
  }, [session])

  if (!supabaseConfigured || !supabase) return <ConfigurationRequired />
  if (authLoading) return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">T</div><h1>Starting TipSplit…</h1><p>Checking your secure sign-in session.</p></section></main>
  if (!session) return <AuthScreen />
  if (membershipLoading) return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">T</div><h1>Checking workspace access…</h1><p>Verifying your account permissions.</p></section></main>
  if (membershipError || !role) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-mark">T</div>
          <p className="eyebrow">ACCESS CONTROL</p>
          <h1>Workspace access required</h1>
          <p className="auth-error">{membershipError || 'This account is signed in but has not been added to the TipSplit workspace.'}</p>
          <p>Ask the café's workspace admin to grant your Supabase account access to the TipSplit workspace. Creating an account alone does not grant access to café data.</p>
          <button className="primary-button" type="button" onClick={() => { void supabase?.auth.signOut() }}>Sign out</button>
        </section>
      </main>
    )
  }

  return <TipSplitDashboard key={session.user.id} user={session.user} workspaceId={TIPSPLIT_WORKSPACE_ID} role={role} onSignOut={async () => { await supabase?.auth.signOut() }} />
}

export default App
