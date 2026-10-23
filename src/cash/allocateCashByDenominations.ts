import {
  CASH_DENOMINATIONS,
  createEmptyDenominationCounts,
  isCashDenominationCounts,
  sumDenominationsCents,
  type CashDenominationCounts,
} from './denominations'
import type { Share } from '../calculations/splitCents'

export type CashPayout = {
  employeeId: string
  targetCents: number
  paidCents: number
  denominations: CashDenominationCounts
  remainingCents: number
}

export type CashDistribution = {
  availableCents: number
  distributedCents: number
  leftoverCents: number
  employees: CashPayout[]
  leftoverDenominations: CashDenominationCounts
}

/**
 * Suggests physical cash payouts using only the notes and coins available.
 *
 * Each employee's target is the weighted share calculated by calculateTipAllocation.
 * Cash units are processed from largest to smallest. A unit is assigned to the
 * employee with the largest proportional shortfall, as long as it does not make
 * that employee exceed their target. If no employee can accept a unit, it stays
 * in the supervisor remainder. Ties are resolved by input order.
 *
 * This is a deterministic greedy recommendation, not a mathematically unique
 * solution. It never overpays an employee, spends an unavailable denomination,
 * or loses cash. The remainder stays visible for the supervisor to decide.
 */
export function allocateCashByDenominations(
  availableDenominations: CashDenominationCounts,
  targets: Share[],
): CashDistribution {
  if (!isCashDenominationCounts(availableDenominations)) {
    throw new Error('Enter a valid non-negative whole-number count for every cash denomination.')
  }

  const availableCents = sumDenominationsCents(availableDenominations)
  if (new Set(targets.map((target) => target.employeeId)).size !== targets.length) {
    throw new Error('Target employee IDs must not contain duplicates.')
  }
  for (const target of targets) {
    if (typeof target.employeeId !== 'string' || target.employeeId.trim().length === 0 || !Number.isSafeInteger(target.cents) || target.cents < 0) {
      throw new Error('Every target must have an employee ID and a valid non-negative amount in cents.')
    }
  }

  const targetTotal = targets.reduce((sum, target) => sum + BigInt(target.cents), 0n)
  if (targetTotal !== BigInt(availableCents)) {
    throw new Error('Employee target shares must sum exactly to the available cash total.')
  }

  // Bound the number of discrete pieces so an accidental huge count cannot hang the UI.
  const pieceCount = CASH_DENOMINATIONS.reduce(
    (sum, denomination) => sum + BigInt(availableDenominations[denomination.id]),
    0n,
  )
  if (pieceCount > 100_000n) {
    throw new RangeError('The cash count contains more than 100,000 individual notes and coins. Check the counts.')
  }

  const payouts: CashPayout[] = targets.map((target) => ({
    employeeId: target.employeeId,
    targetCents: target.cents,
    paidCents: 0,
    denominations: createEmptyDenominationCounts(),
    remainingCents: target.cents,
  }))
  const leftoverDenominations = { ...availableDenominations }

  for (const denomination of CASH_DENOMINATIONS) {
    let unitsLeft = availableDenominations[denomination.id]

    while (unitsLeft > 0) {
      let chosenIndex = -1

      for (let index = 0; index < payouts.length; index += 1) {
        const payout = payouts[index]
        if (payout.remainingCents < denomination.cents || payout.targetCents === 0) continue

        if (chosenIndex === -1) {
          chosenIndex = index
          continue
        }

        const chosen = payouts[chosenIndex]
        // Compare relative shortfalls exactly: candidateRemaining / candidateTarget.
        const candidateScore = BigInt(payout.remainingCents) * BigInt(chosen.targetCents)
        const chosenScore = BigInt(chosen.remainingCents) * BigInt(payout.targetCents)
        if (candidateScore > chosenScore) chosenIndex = index
      }

      if (chosenIndex === -1) break

      const payout = payouts[chosenIndex]
      payout.denominations[denomination.id] += 1
      payout.paidCents += denomination.cents
      payout.remainingCents -= denomination.cents
      unitsLeft -= 1
      leftoverDenominations[denomination.id] -= 1
    }
  }

  const distributedCents = payouts.reduce((sum, payout) => sum + payout.paidCents, 0)
  const leftoverCents = sumDenominationsCents(leftoverDenominations)

  if (distributedCents + leftoverCents !== availableCents) {
    throw new Error('Cash allocation check failed: distributed cash plus remainder must equal the starting cash.')
  }

  return {
    availableCents,
    distributedCents,
    leftoverCents,
    employees: payouts,
    leftoverDenominations,
  }
}
