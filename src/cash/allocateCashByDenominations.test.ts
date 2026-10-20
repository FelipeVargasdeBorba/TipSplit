import { describe, expect, it } from 'vitest'
import { allocateCashByDenominations } from './allocateCashByDenominations'
import { createEmptyDenominationCounts, sumDenominationsCents } from './denominations'
import type { Share } from '../calculations/splitCents'
import { calculateTipAllocation } from '../calculations/calculateTipAllocation'

function targets(shares: Array<[string, number]>): Share[] {
  return shares.map(([employeeId, cents]) => ({ employeeId, cents }))
}

describe('allocateCashByDenominations', () => {
  it('matches weighted target amounts when available denominations allow an exact payout', () => {
    const counts = createEmptyDenominationCounts()
    counts.note50 = 1
    counts.note20 = 2
    counts.note10 = 4
    const weightedTargets = calculateTipAllocation(13000, ['a', 'b', 'c'], ['c'])
    expect(weightedTargets.map((share) => share.cents)).toEqual([4000, 4000, 5000])
    const result = allocateCashByDenominations(counts, weightedTargets)

    expect(result.employees.map((employee) => employee.paidCents)).toEqual([4000, 4000, 5000])
    expect(result.distributedCents).toBe(13000)
    expect(result.leftoverCents).toBe(0)
    expect(result.distributedCents + result.leftoverCents).toBe(result.availableCents)
  })


  it('shows cash that cannot be handed out without exceeding any target', () => {
    const counts = createEmptyDenominationCounts()
    counts.note50 = 1
    counts.note20 = 2
    counts.note10 = 1
    const result = allocateCashByDenominations(counts, targets([
      ['a', 3000], ['b', 3000], ['c', 4000],
    ]))

    expect(result.employees.map((employee) => employee.paidCents)).toEqual([2000, 2000, 1000])
    expect(result.distributedCents).toBe(5000)
    expect(result.leftoverCents).toBe(5000)
    expect(result.leftoverDenominations.note50).toBe(1)
  })

  it('never gives an employee more than the calculated target', () => {
    const counts = createEmptyDenominationCounts()
    counts.note50 = 1
    counts.note20 = 2
    counts.note10 = 4
    const result = allocateCashByDenominations(counts, targets([
      ['a', 4000], ['b', 4000], ['c', 5000],
    ]))

    for (const payout of result.employees) {
      expect(payout.paidCents).toBeLessThanOrEqual(payout.targetCents)
      expect(sumDenominationsCents(payout.denominations)).toBe(payout.paidCents)
    }
  })

  it('preserves every physical note and coin across payouts plus remainder', () => {
    const counts = createEmptyDenominationCounts()
    counts.note20 = 2
    counts.note10 = 2
    counts.note5 = 2
    counts.coin2 = 2
    counts.coin50c = 3
    counts.coin20c = 2
    counts.coin5c = 1
    const total = sumDenominationsCents(counts)
    const shareA = Math.floor(total / 2)
    const result = allocateCashByDenominations(counts, targets([
      ['a', shareA], ['b', total - shareA],
    ]))

    for (const denomination of Object.keys(counts) as Array<keyof typeof counts>) {
      const used = result.employees.reduce((sum, payout) => sum + payout.denominations[denomination], 0)
      expect(used + result.leftoverDenominations[denomination]).toBe(counts[denomination])
    }
    expect(result.distributedCents + result.leftoverCents).toBe(total)
  })

  it('keeps all cash in the remainder when there are no targets and no cash', () => {
    const counts = createEmptyDenominationCounts()
    const result = allocateCashByDenominations(counts, [])
    expect(result.availableCents).toBe(0)
    expect(result.leftoverCents).toBe(0)
    expect(result.employees).toEqual([])
  })

  it('rejects target totals that do not match the inventory', () => {
    const counts = createEmptyDenominationCounts()
    counts.note10 = 1
    expect(() => allocateCashByDenominations(counts, targets([['a', 900]]))).toThrow(/sum exactly/i)
  })

  it('rejects duplicate target employee IDs', () => {
    const counts = createEmptyDenominationCounts()
    expect(() => allocateCashByDenominations(counts, targets([['a', 0], ['a', 0]]))).toThrow(/duplicates/i)
  })

  it('rejects more than 100,000 individual pieces', () => {
    const counts = createEmptyDenominationCounts()
    counts.coin1c = 100001
    expect(() => allocateCashByDenominations(counts, targets([['a', 100001]]))).toThrow(/100,000/i)
  })


  it('preserves targets and every denomination across 250 deterministic inventory scenarios', () => {
    // Deterministic pseudo-random sequence makes failures repeatable in CI.
    let seed = 0x5eed1234
    const next = (maxExclusive: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed % maxExclusive
    }

    for (let scenario = 0; scenario < 250; scenario += 1) {
      const counts = createEmptyDenominationCounts()
      for (const denomination of Object.keys(counts) as Array<keyof typeof counts>) {
        counts[denomination] = next(4)
      }
      const total = sumDenominationsCents(counts)
      const employeeCount = 1 + next(6)
      const ids = Array.from({ length: employeeCount }, (_, index) => `scenario-${scenario}-employee-${index}`)
      const closers = ids.filter(() => next(3) === 0)
      const shares = calculateTipAllocation(total, ids, closers)
      const result = allocateCashByDenominations(counts, shares)

      expect(result.distributedCents + result.leftoverCents).toBe(total)
      expect(result.availableCents).toBe(total)
      expect(result.employees.reduce((sum, payout) => sum + payout.paidCents, 0)).toBe(result.distributedCents)

      for (const payout of result.employees) {
        expect(payout.paidCents).toBeLessThanOrEqual(payout.targetCents)
        expect(sumDenominationsCents(payout.denominations)).toBe(payout.paidCents)
      }

      for (const denomination of Object.keys(counts) as Array<keyof typeof counts>) {
        const paidCount = result.employees.reduce((sum, payout) => sum + payout.denominations[denomination], 0)
        expect(paidCount + result.leftoverDenominations[denomination]).toBe(counts[denomination])
      }
    }
  })

  it('rejects unsafe or malformed target amounts before BigInt conversion', () => {
    const counts = createEmptyDenominationCounts()
    expect(() => allocateCashByDenominations(counts, [{ employeeId: 'a', cents: Number.MAX_SAFE_INTEGER + 1 }])).toThrow(/valid non-negative amount/i)
    expect(() => allocateCashByDenominations(counts, [{ employeeId: 'a', cents: -1 }])).toThrow(/valid non-negative amount/i)
    expect(() => allocateCashByDenominations(counts, [{ employeeId: ' ', cents: 0 }])).toThrow(/valid non-negative amount/i)
  })
})
