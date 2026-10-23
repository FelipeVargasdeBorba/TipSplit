import { describe, expect, it } from 'vitest'
import { calculateTipAllocation } from './calculateTipAllocation'

describe('calculateTipAllocation', () => {
  it('allocates €130 as €40, €40 and €50 with one closing employee', () => {
    expect(calculateTipAllocation(13_000, ['a', 'b', 'c'], ['c'])).toEqual([
      { employeeId: 'a', cents: 4_000 },
      { employeeId: 'b', cents: 4_000 },
      { employeeId: 'c', cents: 5_000 },
    ])
  })

  it('splits equally apart from cent rounding when nobody is closing', () => {
    expect(calculateTipAllocation(100, ['a', 'b', 'c'], [])).toEqual([
      { employeeId: 'a', cents: 34 },
      { employeeId: 'b', cents: 33 },
      { employeeId: 'c', cents: 33 },
    ])
  })

  it('splits equally apart from cent rounding when everyone is closing', () => {
    expect(calculateTipAllocation(100, ['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([
      { employeeId: 'a', cents: 34 },
      { employeeId: 'b', cents: 33 },
      { employeeId: 'c', cents: 33 },
    ])
  })

  it('gives a closing employee a higher allocation weight when the pot is large enough', () => {
    expect(calculateTipAllocation(100, ['normal', 'closing'], ['closing'])).toEqual([
      { employeeId: 'normal', cents: 44 },
      { employeeId: 'closing', cents: 56 },
    ])
  })

  it('supports multiple closing employees', () => {
    expect(calculateTipAllocation(14_000, ['a', 'b', 'c', 'd'], ['c', 'd'])).toEqual([
      { employeeId: 'a', cents: 3_111 },
      { employeeId: 'b', cents: 3_111 },
      { employeeId: 'c', cents: 3_889 },
      { employeeId: 'd', cents: 3_889 },
    ])
  })

  it('gives a single eligible employee the entire pool', () => {
    expect(calculateTipAllocation(5_123, ['a'], [])).toEqual([
      { employeeId: 'a', cents: 5_123 },
    ])
    expect(calculateTipAllocation(5_123, ['a'], ['a'])).toEqual([
      { employeeId: 'a', cents: 5_123 },
    ])
  })

  it('supports a zero-cent pool, including an empty team', () => {
    expect(calculateTipAllocation(0, ['a', 'b'], ['b'])).toEqual([
      { employeeId: 'a', cents: 0 },
      { employeeId: 'b', cents: 0 },
    ])
    expect(calculateTipAllocation(0, [], [])).toEqual([])
  })

  it('allocates leftover cents exactly using largest remainders', () => {
    const result = calculateTipAllocation(7, ['a', 'b', 'c'], ['c'])
    expect(result.reduce((sum, share) => sum + share.cents, 0)).toBe(7)
    expect(result).toEqual([
      { employeeId: 'a', cents: 2 },
      { employeeId: 'b', cents: 2 },
      { employeeId: 'c', cents: 3 },
    ])
  })

  it('always preserves the total for a range of valid values', () => {
    for (let total = 0; total <= 500; total += 1) {
      for (const closers of [[], ['b'], ['a', 'b', 'c']]) {
        const result = calculateTipAllocation(total, ['a', 'b', 'c'], closers)
        expect(result.reduce((sum, share) => sum + share.cents, 0)).toBe(total)
        expect(result.every((share) => Number.isSafeInteger(share.cents) && share.cents >= 0)).toBe(true)
      }
    }
  })

  it('rejects negative amounts', () => {
    expect(() => calculateTipAllocation(-1, ['a'], [])).toThrow(RangeError)
  })

  it('rejects unsafe integer amounts', () => {
    expect(() => calculateTipAllocation(Number.MAX_SAFE_INTEGER + 1, ['a'], [])).toThrow(RangeError)
  })

  it('rejects duplicate employee IDs', () => {
    expect(() => calculateTipAllocation(100, ['a', 'a'], [])).toThrow(/employeeIds.*duplicates/)
  })

  it('rejects duplicate closing IDs', () => {
    expect(() => calculateTipAllocation(100, ['a'], ['a', 'a'])).toThrow(/closingEmployeeIds.*duplicates/)
  })

  it('rejects a closing ID that is not eligible', () => {
    expect(() => calculateTipAllocation(100, ['a'], ['b'])).toThrow(/must also be included/)
  })

  it('rejects a positive pool with no eligible employees', () => {
    expect(() => calculateTipAllocation(1, [], [])).toThrow(RangeError)
  })

  it('does not mutate either input array', () => {
    const employees = ['a', 'b', 'c']
    const closers = ['c']
    calculateTipAllocation(13_000, employees, closers)
    expect(employees).toEqual(['a', 'b', 'c'])
    expect(closers).toEqual(['c'])
  })

  it('resolves equal remainders deterministically by employee input order', () => {
    const firstOrder = calculateTipAllocation(1, ['a', 'b'], [])
    const secondOrder = calculateTipAllocation(1, ['b', 'a'], [])
    expect(firstOrder).toEqual([
      { employeeId: 'a', cents: 1 },
      { employeeId: 'b', cents: 0 },
    ])
    expect(secondOrder).toEqual([
      { employeeId: 'b', cents: 1 },
      { employeeId: 'a', cents: 0 },
    ])
  })


  it('preserves every cent across 500 deterministic weighted-allocation scenarios', () => {
    let seed = 0xdecafbad
    const next = (maxExclusive: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return seed % maxExclusive
    }

    for (let scenario = 0; scenario < 500; scenario += 1) {
      const count = 1 + next(12)
      const ids = Array.from({ length: count }, (_, index) => `property-${scenario}-${index}`)
      const closers = ids.filter(() => next(2) === 0)
      const total = next(1_000_000)
      const shares = calculateTipAllocation(total, ids, closers)

      expect(shares.map((share) => share.employeeId)).toEqual(ids)
      expect(shares.reduce((sum, share) => sum + share.cents, 0)).toBe(total)
      expect(shares.every((share) => Number.isSafeInteger(share.cents) && share.cents >= 0)).toBe(true)
    }
  })

  it('supports the largest safe total without overflow for a single employee', () => {
    expect(calculateTipAllocation(Number.MAX_SAFE_INTEGER, ['only'], [])).toEqual([
      { employeeId: 'only', cents: Number.MAX_SAFE_INTEGER },
    ])
  })
})

describe('late-night departure and supervisor weights', () => {
  it('allocates according to 100/80/60/40/20 departure weights', () => {
    const ids = ['close', 'one', 'two', 'three', 'four']
    const result = calculateTipAllocation(30000, ids, [], {
      hoursBeforeCloseByEmployeeId: { close: 0, one: 1, two: 2, three: 3, four: 4 },
      supervisorIds: [],
    })
    expect(result.map((share) => share.cents)).toEqual([10000, 8000, 6000, 4000, 2000])
  })

  it('multiplies a supervisor base weight by 1.2', () => {
    const result = calculateTipAllocation(10000, ['normal', 'supervisor'], [], {
      hoursBeforeCloseByEmployeeId: { normal: 0, supervisor: 1 },
      supervisorIds: ['supervisor'],
    })
    expect(result.map((share) => share.cents)).toEqual([5102, 4898])
  })
})
