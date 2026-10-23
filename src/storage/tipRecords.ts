import { CASH_DENOMINATIONS, isCashDenominationCounts, sumDenominationsCents, type CashDenominationCounts } from '../cash/denominations'

export type StoredEmployee = {
  id: string
  name: string
  isSupervisor?: boolean
}

export type TipRecordEmployee = {
  employeeId: string
  employeeName: string
  cents: number
  closing: boolean
  /** Hours before closing (0 means worked until close). */
  hoursBeforeClose?: number
  /** Whether the employee was a supervisor when this record was saved. */
  supervisor?: boolean
  /** Optional for backwards compatibility with records saved before cash tracking. */
  denominations?: CashDenominationCounts
  /** Total physical cash handed to this employee, in cents. */
  deliveredCents?: number
}

export type TipRecord = {
  id: string
  /** Business date in YYYY-MM-DD format. */
  date: string
  createdAt: string
  totalCents: number
  employees: TipRecordEmployee[]
  /** Inventory counted before distribution; absent on older records. */
  sourceDenominations?: CashDenominationCounts
  /** Cash retained by the supervisor after suggested payouts; absent on older records. */
  leftoverDenominations?: CashDenominationCounts
  leftoverCents?: number
}

export const EMPLOYEES_STORAGE_KEY = 'tipsplit.employees.v1'
export const TIP_RECORDS_STORAGE_KEY = 'tipsplit.tipRecords.v1'

function getStorage(): Storage | null {
  // Access can throw in restricted/private browser contexts, not only when the API is absent.
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function isValidBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isValidCreatedAt(value: string): boolean {
  const parsed = new Date(value)
  // App-generated timestamps use canonical ISO UTC strings, including milliseconds.
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredEmployee(value: unknown): value is StoredEmployee {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    (value.isSupervisor === undefined || typeof value.isSupervisor === 'boolean')
  )
}

function isTipRecordEmployee(value: unknown): value is TipRecordEmployee {
  if (
    !isObject(value) ||
    typeof value.employeeId !== 'string' ||
    value.employeeId.length === 0 ||
    typeof value.employeeName !== 'string' ||
    value.employeeName.trim().length === 0 ||
    !Number.isSafeInteger(value.cents) ||
    (value.cents as number) < 0 ||
    typeof value.closing !== 'boolean' ||
    (value.hoursBeforeClose !== undefined && (typeof value.hoursBeforeClose !== 'number' || !Number.isInteger(value.hoursBeforeClose) || value.hoursBeforeClose < 0 || value.hoursBeforeClose > 4)) ||
    (value.supervisor !== undefined && typeof value.supervisor !== 'boolean')
  ) {
    return false
  }

  const hasDenominations = Object.prototype.hasOwnProperty.call(value, 'denominations')
  const hasDeliveredCents = Object.prototype.hasOwnProperty.call(value, 'deliveredCents')

  // Old records do not contain cash-handout details. They remain valid and display as unrecorded.
  if (!hasDenominations && !hasDeliveredCents) return true
  if (!hasDenominations || !hasDeliveredCents) return false
  if (!isCashDenominationCounts(value.denominations)) return false
  if (!Number.isSafeInteger(value.deliveredCents) || (value.deliveredCents as number) < 0) return false

  const denominations = value.denominations
  if (!isCashDenominationCounts(denominations)) return false

  const calculatedDelivered = CASH_DENOMINATIONS.reduce(
    (sum, denomination) => sum + BigInt(denominations[denomination.id]) * BigInt(denomination.cents),
    0n,
  )

  return calculatedDelivered === BigInt(value.deliveredCents as number)
}

function isTipRecord(value: unknown): value is TipRecord {
  if (
    !isObject(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.date !== 'string' ||
    !isValidBusinessDate(value.date) ||
    typeof value.createdAt !== 'string' ||
    !isValidCreatedAt(value.createdAt) ||
    !Number.isSafeInteger(value.totalCents) ||
    (value.totalCents as number) < 0 ||
    !Array.isArray(value.employees) ||
    !value.employees.every(isTipRecordEmployee)
  ) {
    return false
  }

  const employees = value.employees as TipRecordEmployee[]
  const uniqueEmployeeIds = new Set(employees.map((employee) => employee.employeeId))
  if (uniqueEmployeeIds.size !== employees.length) return false

  const employeeTotal = employees.reduce((sum, employee) => sum + BigInt(employee.cents), 0n)
  if (employeeTotal !== BigInt(value.totalCents as number)) return false

  const hasSourceDenominations = Object.prototype.hasOwnProperty.call(value, 'sourceDenominations')
  const hasLeftoverDenominations = Object.prototype.hasOwnProperty.call(value, 'leftoverDenominations')
  const hasLeftoverCents = Object.prototype.hasOwnProperty.call(value, 'leftoverCents')
  if (!hasSourceDenominations && !hasLeftoverDenominations && !hasLeftoverCents) return true
  if (!hasSourceDenominations || !hasLeftoverDenominations || !hasLeftoverCents) return false
  if (!isCashDenominationCounts(value.sourceDenominations) || !isCashDenominationCounts(value.leftoverDenominations)) return false
  if (!Number.isSafeInteger(value.leftoverCents) || (value.leftoverCents as number) < 0) return false
  if (!employees.every((employee) => employee.denominations !== undefined && employee.deliveredCents !== undefined)) return false
  // Current inventory-based records are suggested payouts: never allow a saved payout
  // to exceed that employee's fair target. Legacy records without inventory stay compatible.
  if (employees.some((employee) => (employee.deliveredCents as number) > employee.cents)) return false

  // A malformed record must not make the whole history unreadable. In particular,
  // summing individually safe denomination counts can still overflow the safe total.
  try {
    if (sumDenominationsCents(value.sourceDenominations) !== value.totalCents) return false
    if (sumDenominationsCents(value.leftoverDenominations) !== value.leftoverCents) return false

    const deliveredTotal = employees.reduce((sum, employee) => sum + BigInt(employee.deliveredCents as number), 0n)
    if (deliveredTotal + BigInt(value.leftoverCents as number) !== BigInt(value.totalCents as number)) return false

    for (const denomination of CASH_DENOMINATIONS) {
      const usedByEmployees = employees.reduce(
        (sum, employee) => sum + BigInt(employee.denominations![denomination.id]),
        0n,
      )
      const accountedCount = usedByEmployees + BigInt(value.leftoverDenominations[denomination.id])
      if (accountedCount !== BigInt(value.sourceDenominations[denomination.id])) return false
    }
  } catch {
    return false
  }
  return true
}

export function loadEmployees(fallback: StoredEmployee[] = []): StoredEmployee[] {
  const storage = getStorage()
  if (!storage) return fallback.map((employee) => ({ ...employee }))

  try {
    const raw = storage.getItem(EMPLOYEES_STORAGE_KEY)
    if (raw === null) return fallback.map((employee) => ({ ...employee }))

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return fallback.map((employee) => ({ ...employee }))

    const uniqueEmployees: StoredEmployee[] = []
    const seenIds = new Set<string>()
    for (const employee of parsed) {
      if (!isStoredEmployee(employee) || seenIds.has(employee.id)) continue
      seenIds.add(employee.id)
      uniqueEmployees.push({ id: employee.id, name: employee.name, ...(employee.isSupervisor === undefined ? {} : { isSupervisor: employee.isSupervisor }) })
    }
    return uniqueEmployees
  } catch {
    return fallback.map((employee) => ({ ...employee }))
  }
}

export function saveEmployees(employees: StoredEmployee[]): void {
  const storage = getStorage()
  if (!storage) throw new Error('Browser storage is unavailable.')
  if (!employees.every(isStoredEmployee)) {
    throw new Error('Cannot save an invalid team list.')
  }
  const ids = employees.map((employee) => employee.id)
  if (new Set(ids).size !== ids.length) {
    throw new Error('Cannot save duplicate employee IDs.')
  }
  storage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(employees))
}

export function loadTipRecords(): TipRecord[] {
  const storage = getStorage()
  if (!storage) return []

  try {
    const raw = storage.getItem(TIP_RECORDS_STORAGE_KEY)
    if (raw === null) return []

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const validRecords = parsed.filter(isTipRecord)
    const seenIds = new Set<string>()
    return validRecords.filter((record) => {
      if (seenIds.has(record.id)) return false
      seenIds.add(record.id)
      return true
    })
  } catch {
    return []
  }
}

export function saveTipRecords(records: TipRecord[]): void {
  const storage = getStorage()
  if (!storage) throw new Error('Browser storage is unavailable.')
  if (!records.every(isTipRecord)) {
    throw new Error('Cannot save invalid tip records. Check the totals and employee shares.')
  }

  const ids = records.map((record) => record.id)
  if (new Set(ids).size !== ids.length) {
    throw new Error('Cannot save duplicate record IDs.')
  }

  const dates = records.map((record) => record.date)
  if (new Set(dates).size !== dates.length) {
    throw new Error('A tip record for this business date already exists.')
  }

  storage.setItem(TIP_RECORDS_STORAGE_KEY, JSON.stringify(records))
}

/** Validate JSON loaded from the shared database using the same rules as local records. */
export function isValidTipRecord(value: unknown): value is TipRecord {
  return isTipRecord(value)
}
