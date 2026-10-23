import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyDenominationCounts } from '../cash/denominations'
import {
  EMPLOYEES_STORAGE_KEY,
  loadEmployees,
  loadTipRecords,
  saveEmployees,
  saveTipRecords,
  TIP_RECORDS_STORAGE_KEY,
  type TipRecord,
} from './tipRecords'

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(String(key), String(value))
    },
  }
}

const sampleRecord: TipRecord = {
  id: 'record-1',
  date: '2026-10-20',
  createdAt: '2026-10-20T18:30:00.000Z',
  totalCents: 10000,
  employees: [
    { employeeId: 'e1', employeeName: 'Alex', cents: 4444, closing: false },
    { employeeId: 'e2', employeeName: 'Sam', cents: 5556, closing: true },
  ],
}

describe('TipSplit local storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves and reloads the team list', () => {
    const employees = [
      { id: 'e1', name: 'Alex' },
      { id: 'e2', name: 'Sam' },
    ]
    saveEmployees(employees)
    expect(loadEmployees([])).toEqual(employees)
    expect(localStorage.getItem(EMPLOYEES_STORAGE_KEY)).not.toBeNull()
  })

  it('uses the fallback team list when no saved team exists', () => {
    expect(loadEmployees([{ id: 'e1', name: 'Alex' }])).toEqual([
      { id: 'e1', name: 'Alex' },
    ])
  })

  it('saves and reloads valid tip records', () => {
    saveTipRecords([sampleRecord])
    expect(loadTipRecords()).toEqual([sampleRecord])
    expect(localStorage.getItem(TIP_RECORDS_STORAGE_KEY)).not.toBeNull()
  })

  it('rejects a record when employee allocations do not sum to the pool', () => {
    expect(() =>
      saveTipRecords([
        {
          ...sampleRecord,
          employees: sampleRecord.employees.map((employee, index) =>
            index === 0 ? { ...employee, cents: employee.cents + 1 } : employee,
          ),
        },
      ]),
    ).toThrow(/invalid tip records/i)
  })

  it('prevents more than one saved record for the same business date', () => {
    expect(() =>
      saveTipRecords([
        sampleRecord,
        { ...sampleRecord, id: 'record-2' },
      ]),
    ).toThrow(/already exists/i)
  })

  it('ignores malformed stored JSON safely', () => {
    localStorage.setItem(TIP_RECORDS_STORAGE_KEY, '{not valid json')
    expect(loadTipRecords()).toEqual([])
  })

  it('saves denomination counts and the actual delivered amount', () => {
    const alexCash = createEmptyDenominationCounts()
    alexCash.note20 = 2
    alexCash.note5 = 1
    const samCash = createEmptyDenominationCounts()
    samCash.note50 = 1
    const record: TipRecord = {
      ...sampleRecord,
      totalCents: 10000,
      employees: [
        { employeeId: 'e1', employeeName: 'Alex', cents: 4500, closing: false, denominations: alexCash, deliveredCents: 4500 },
        { employeeId: 'e2', employeeName: 'Sam', cents: 5500, closing: true, denominations: samCash, deliveredCents: 5000 },
      ],
    }

    saveTipRecords([record])
    expect(loadTipRecords()).toEqual([record])
  })

  it('rejects denomination counts when they do not match the delivered amount', () => {
    const counts = createEmptyDenominationCounts()
    counts.note5 = 1
    expect(() => saveTipRecords([{
      ...sampleRecord,
      employees: [
        { employeeId: 'e1', employeeName: 'Alex', cents: 4500, closing: false, denominations: counts, deliveredCents: 400 },
        { employeeId: 'e2', employeeName: 'Sam', cents: 5500, closing: true },
      ],
    }])).toThrow(/invalid tip records/i)
  })


  it('stores the starting cash inventory and supervisor remainder without losing cash', () => {
    const source = createEmptyDenominationCounts()
    source.note50 = 1
    source.note20 = 2
    source.note10 = 1

    const alex = createEmptyDenominationCounts()
    alex.note20 = 1
    const sam = createEmptyDenominationCounts()
    sam.note20 = 1
    const chris = createEmptyDenominationCounts()
    chris.note10 = 1
    const leftover = createEmptyDenominationCounts()
    leftover.note50 = 1

    const record: TipRecord = {
      id: 'inventory-record',
      date: '2026-10-21',
      createdAt: '2026-10-21T18:30:00.000Z',
      totalCents: 10000,
      sourceDenominations: source,
      leftoverDenominations: leftover,
      leftoverCents: 5000,
      employees: [
        { employeeId: 'e1', employeeName: 'Alex', cents: 3000, closing: false, denominations: alex, deliveredCents: 2000 },
        { employeeId: 'e2', employeeName: 'Sam', cents: 3000, closing: false, denominations: sam, deliveredCents: 2000 },
        { employeeId: 'e3', employeeName: 'Chris', cents: 4000, closing: true, denominations: chris, deliveredCents: 1000 },
      ],
    }

    saveTipRecords([record])
    expect(loadTipRecords()).toEqual([record])
  })

  it('keeps older records valid when cash denomination details are absent', () => {
    saveTipRecords([sampleRecord])
    expect(loadTipRecords()).toEqual([sampleRecord])
  })


  it('rejects impossible calendar dates instead of accepting date-shaped strings', () => {
    expect(() => saveTipRecords([{ ...sampleRecord, date: '2026-02-30' }])).toThrow(/invalid tip records/i)
  })

  it('rejects invalid created-at timestamps', () => {
    expect(() => saveTipRecords([{ ...sampleRecord, createdAt: 'not-a-timestamp' }])).toThrow(/invalid tip records/i)
    expect(() => saveTipRecords([{ ...sampleRecord, createdAt: '2026-10-20' }])).toThrow(/invalid tip records/i)
  })

  it('rejects an inventory-based payout that exceeds an employee target', () => {
    const source = createEmptyDenominationCounts()
    source.note50 = 2
    const alex = createEmptyDenominationCounts()
    alex.note50 = 1
    const sam = createEmptyDenominationCounts()
    sam.note50 = 1
    const leftover = createEmptyDenominationCounts()

    expect(() => saveTipRecords([{
      ...sampleRecord,
      sourceDenominations: source,
      leftoverDenominations: leftover,
      leftoverCents: 0,
      employees: [
        { employeeId: 'e1', employeeName: 'Alex', cents: 4444, closing: false, denominations: alex, deliveredCents: 5000 },
        { employeeId: 'e2', employeeName: 'Sam', cents: 5556, closing: true, denominations: sam, deliveredCents: 5000 },
      ],
    }])).toThrow(/invalid tip records/i)
  })

  it('skips a malformed oversized inventory record but still loads other valid records', () => {
    const oversizedSource = createEmptyDenominationCounts()
    const oversizedRecord = {
      ...sampleRecord,
      id: 'oversized-record',
      date: '2026-10-19',
      sourceDenominations: oversizedSource,
      leftoverDenominations: createEmptyDenominationCounts(),
      leftoverCents: 0,
      employees: sampleRecord.employees.map((employee) => ({
        ...employee,
        denominations: createEmptyDenominationCounts(),
        deliveredCents: 0,
      })),
    }
    localStorage.setItem(TIP_RECORDS_STORAGE_KEY, JSON.stringify([oversizedRecord, sampleRecord]))
    expect(loadTipRecords()).toEqual([sampleRecord])
  })

  it('falls back safely when browser storage reads throw', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('Storage access denied') },
      setItem() { throw new Error('Storage access denied') },
      removeItem() {},
      clear() {},
      key() { return null },
      get length() { return 0 },
    } as Storage)

    const fallback = [{ id: 'fallback', name: 'Fallback employee' }]
    expect(loadEmployees(fallback)).toEqual(fallback)
    expect(loadTipRecords()).toEqual([])
  })

  it('reports storage write failures instead of pretending the record was saved', () => {
    vi.stubGlobal('localStorage', {
      getItem() { return null },
      setItem() { throw new Error('Quota exceeded') },
      removeItem() {},
      clear() {},
      key() { return null },
      get length() { return 0 },
    } as Storage)
    expect(() => saveTipRecords([sampleRecord])).toThrow(/Quota exceeded/)
  })
})
