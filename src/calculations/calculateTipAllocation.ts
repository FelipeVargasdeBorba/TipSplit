import type { Share } from './splitCents'

/** Closing employees receive this multiple of the normal allocation weight. */
export const CLOSING_WEIGHT_MULTIPLIER = 1.25

// Convert policy weights to integer units once. Allocation arithmetic itself uses BigInt.
const WEIGHT_SCALE = 100n
const NORMAL_WEIGHT_UNITS = WEIGHT_SCALE
const CLOSING_WEIGHT_UNITS = BigInt(
  Math.round(CLOSING_WEIGHT_MULTIPLIER * Number(WEIGHT_SCALE)),
)

type WeightedShare = {
  employeeId: string
  cents: bigint
  remainder: bigint
  originalIndex: number
}

/**
 * Splits a non-negative integer cash-tip amount by employee weight.
 * Working employees have weight 1.00; closing employees have weight 1.25.
 *
 * Allocations use exact integer arithmetic and the largest-remainder method.
 * Any tied remainders are resolved by the order in employeeIds, ensuring a
 * deterministic result for the same inputs. The result preserves that order.
 *
 * @throws RangeError if totalCents is not a non-negative safe integer, or if
 *   a positive amount is supplied with no eligible employees.
 * @throws Error if employee IDs or closing IDs contain duplicates, or if a
 *   closing ID is not in employeeIds.
 */
export function calculateTipAllocation(
  totalCents: number,
  employeeIds: string[],
  closingEmployeeIds: string[],
): Share[] {
  if (!Number.isSafeInteger(totalCents)) {
    throw new RangeError(
      `totalCents must be a safe integer number of cents, received ${String(totalCents)}`,
    )
  }

  if (totalCents < 0) {
    throw new RangeError(
      `totalCents must not be negative, received ${totalCents}`,
    )
  }

  if (new Set(employeeIds).size !== employeeIds.length) {
    throw new Error('employeeIds must not contain duplicates')
  }

  if (new Set(closingEmployeeIds).size !== closingEmployeeIds.length) {
    throw new Error('closingEmployeeIds must not contain duplicates')
  }

  const eligibleIds = new Set(employeeIds)
  for (const closingId of closingEmployeeIds) {
    if (!eligibleIds.has(closingId)) {
      throw new Error(
        `Closing employee ${closingId} must also be included in employeeIds`,
      )
    }
  }

  if (employeeIds.length === 0) {
    if (totalCents === 0) return []
    throw new RangeError(
      'Cannot allocate a positive amount when there are no eligible employees',
    )
  }

  const closingIds = new Set(closingEmployeeIds)
  const weights = employeeIds.map((employeeId) =>
    closingIds.has(employeeId) ? CLOSING_WEIGHT_UNITS : NORMAL_WEIGHT_UNITS,
  )
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n)
  const total = BigInt(totalCents)

  const weightedShares: WeightedShare[] = employeeIds.map(
    (employeeId, originalIndex) => {
      const numerator = total * weights[originalIndex]
      return {
        employeeId,
        cents: numerator / totalWeight,
        remainder: numerator % totalWeight,
        originalIndex,
      }
    },
  )

  const allocatedBase = weightedShares.reduce(
    (sum, share) => sum + share.cents,
    0n,
  )
  const leftoverCents = total - allocatedBase

  // Largest remainder first; when remainders tie, retain supplied employee order.
  const rankedIndices = weightedShares
    .map((share) => share.originalIndex)
    .sort((leftIndex, rightIndex) => {
      const left = weightedShares[leftIndex].remainder
      const right = weightedShares[rightIndex].remainder
      if (left === right) return leftIndex - rightIndex
      return left > right ? -1 : 1
    })

  // Largest-remainder allocation leaves fewer leftover cents than employees.
  const leftoverCount = Number(leftoverCents)
  for (let index = 0; index < leftoverCount; index += 1) {
    weightedShares[rankedIndices[index]].cents += 1n
  }

  return weightedShares.map((share) => ({
    employeeId: share.employeeId,
    cents: Number(share.cents),
  }))
}
