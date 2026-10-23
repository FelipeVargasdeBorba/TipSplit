export type Share = { employeeId: string; cents: number }

/** Splits a non-negative integer amount of cents equally among the given employees. */
export function splitCents(totalCents: number, employeeIds: string[]): Share[] {
  if (!Number.isSafeInteger(totalCents)) {
    throw new RangeError(`totalCents must be a safe integer number of cents, received ${String(totalCents)}`)
  }
  if (totalCents < 0) throw new RangeError(`totalCents must not be negative, received ${totalCents}`)
  if (new Set(employeeIds).size !== employeeIds.length) throw new Error('employeeIds must not contain duplicates')

  const count = employeeIds.length
  if (count === 0) {
    if (totalCents === 0) return []
    throw new RangeError('Cannot split a positive amount when there are no eligible employees')
  }

  const total = totalCents + 0
  const baseCents = Math.floor(total / count)
  const leftoverCents = total % count
  return employeeIds.map((employeeId, index) => ({
    employeeId,
    cents: baseCents + (index < leftoverCents ? 1 : 0),
  }))
}
