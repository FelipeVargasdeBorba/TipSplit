/** Supported physical euro cash denominations. Values are stored in cents. */
export const CASH_DENOMINATIONS = [
  { id: 'note100', label: '€100 note', shortLabel: '€100', cents: 10000, kind: 'note' },
  { id: 'note50', label: '€50 note', shortLabel: '€50', cents: 5000, kind: 'note' },
  { id: 'note20', label: '€20 note', shortLabel: '€20', cents: 2000, kind: 'note' },
  { id: 'note10', label: '€10 note', shortLabel: '€10', cents: 1000, kind: 'note' },
  { id: 'note5', label: '€5 note', shortLabel: '€5', cents: 500, kind: 'note' },
  { id: 'coin2', label: '€2 coin', shortLabel: '€2', cents: 200, kind: 'coin' },
  { id: 'coin1', label: '€1 coin', shortLabel: '€1', cents: 100, kind: 'coin' },
  { id: 'coin50c', label: '50c coin', shortLabel: '50c', cents: 50, kind: 'coin' },
  { id: 'coin20c', label: '20c coin', shortLabel: '20c', cents: 20, kind: 'coin' },
  { id: 'coin10c', label: '10c coin', shortLabel: '10c', cents: 10, kind: 'coin' },
  { id: 'coin5c', label: '5c coin', shortLabel: '5c', cents: 5, kind: 'coin' },
  { id: 'coin2c', label: '2c coin', shortLabel: '2c', cents: 2, kind: 'coin' },
  { id: 'coin1c', label: '1c coin', shortLabel: '1c', cents: 1, kind: 'coin' },
] as const

export type CashDenominationId = (typeof CASH_DENOMINATIONS)[number]['id']
export type CashDenominationCounts = Record<CashDenominationId, number>

export function createEmptyDenominationCounts(): CashDenominationCounts {
  return Object.fromEntries(
    CASH_DENOMINATIONS.map(({ id }) => [id, 0]),
  ) as CashDenominationCounts
}

/** Sum a physical cash breakdown exactly, using BigInt for intermediate math. */
export function sumDenominationsCents(counts: CashDenominationCounts): number {
  let total = 0n

  for (const denomination of CASH_DENOMINATIONS) {
    const count: unknown = counts[denomination.id]
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new RangeError(`Count for ${denomination.label} must be a non-negative safe integer.`)
    }
    total += BigInt(count as number) * BigInt(denomination.cents)
  }

  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('The cash denomination total is too large to represent safely.')
  }

  return Number(total)
}

export function isCashDenominationCounts(value: unknown): value is CashDenominationCounts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

  const record = value as Record<string, unknown>
  const expectedKeys = CASH_DENOMINATIONS.map(({ id }) => id)
  const actualKeys = Object.keys(record)
  if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key) => !(key in record))) {
    return false
  }

  return expectedKeys.every((key) => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0)
}
