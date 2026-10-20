import { describe, expect, it } from 'vitest'
import {
  CASH_DENOMINATIONS,
  createEmptyDenominationCounts,
  isCashDenominationCounts,
  sumDenominationsCents,
} from './denominations'

describe('cash denomination counting', () => {
  it('starts with zero of every denomination', () => {
    const counts = createEmptyDenominationCounts()
    expect(CASH_DENOMINATIONS.every(({ id }) => counts[id] === 0)).toBe(true)
    expect(sumDenominationsCents(counts)).toBe(0)
  })

  it('sums notes and coins exactly in cents', () => {
    const counts = createEmptyDenominationCounts()
    counts.note20 = 1
    counts.note5 = 1
    counts.coin2 = 1
    counts.coin50c = 1
    counts.coin20c = 1
    expect(sumDenominationsCents(counts)).toBe(2770)
  })

  it('does not allow negative or fractional counts', () => {
    const counts = createEmptyDenominationCounts()
    counts.coin1 = -1
    expect(() => sumDenominationsCents(counts)).toThrow(/non-negative safe integer/i)
    counts.coin1 = 1.5
    expect(() => sumDenominationsCents(counts)).toThrow(/non-negative safe integer/i)
  })

  it('rejects incomplete or malformed denomination objects', () => {
    expect(isCashDenominationCounts({ note5: 2 })).toBe(false)
    expect(isCashDenominationCounts(createEmptyDenominationCounts())).toBe(true)
  })
})
