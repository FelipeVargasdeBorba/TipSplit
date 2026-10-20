import type { User } from '@supabase/supabase-js'
import { isValidTipRecord, type TipRecord, type StoredEmployee } from '../storage/tipRecords'
import { supabase } from '../lib/supabaseClient'

export type WorkspaceRole = 'admin' | 'supervisor'

export type WorkspaceSnapshot = {
  employees: StoredEmployee[]
  records: TipRecord[]
}

function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured. Check your .env.local file.')
  return supabase
}

function isCloudTipRecord(value: unknown): value is TipRecord {
  return isValidTipRecord(value)
}

export async function getWorkspaceRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const client = requireClient()
  const { data, error } = await client
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw new Error(`Could not verify workspace access: ${error.message}`)
  if (!data) return null
  return data.role === 'admin' || data.role === 'supervisor' ? data.role : null
}

export async function loadWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
  const client = requireClient()
  const [employeeResult, recordResult] = await Promise.all([
    client.from('employees').select('id, name').eq('workspace_id', workspaceId).order('created_at', { ascending: true }),
    client.from('tip_records').select('id, business_date, total_cents, payload').eq('workspace_id', workspaceId).order('business_date', { ascending: false }),
  ])

  if (employeeResult.error) throw new Error(`Could not load employees: ${employeeResult.error.message}`)
  if (recordResult.error) throw new Error(`Could not load history: ${recordResult.error.message}`)

  const employeeRows = (employeeResult.data ?? []) as Array<{ id: string; name: string }>
  const employees: StoredEmployee[] = employeeRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
  }))

  const records: TipRecord[] = []
  const recordRows = (recordResult.data ?? []) as Array<{ id: string; business_date: string; total_cents: number | string; payload: unknown }>
  for (const row of recordRows) {
    if (!isCloudTipRecord(row.payload)) {
      // Ignore malformed individual rows instead of blocking the whole history.
      continue
    }
    if (row.payload.id !== row.id || row.payload.date !== row.business_date || row.payload.totalCents !== Number(row.total_cents)) {
      continue
    }
    records.push(row.payload)
  }

  return { employees, records }
}

export async function migrateLocalDataIfWorkspaceEmpty(
  workspaceId: string,
  user: User,
  localEmployees: StoredEmployee[],
  localRecords: TipRecord[],
  role: WorkspaceRole,
): Promise<{ snapshot: WorkspaceSnapshot; migratedEmployees: number; migratedRecords: number }> {
  const client = requireClient()
  const before = await loadWorkspaceSnapshot(workspaceId)
  let migratedEmployees = 0
  let migratedRecords = 0
  const workspaceWasEmpty = before.employees.length === 0 && before.records.length === 0

  // Only an admin can seed/import the initial local data. Supervisors should not
  // create a second team's roster from whatever happens to be on their device.
  // Import only when the entire workspace is empty; this avoids re-importing
  // locally cached records later if an admin intentionally deletes cloud history.
  if (role === 'admin' && workspaceWasEmpty && localEmployees.length > 0) {
    const rows = localEmployees.map((employee) => ({
      id: employee.id,
      workspace_id: workspaceId,
      name: employee.name,
    }))
    const { error } = await client.from('employees').upsert(rows, { onConflict: 'workspace_id,id', ignoreDuplicates: true })
    if (error) throw new Error(`Could not import the local team list: ${error.message}`)
    migratedEmployees = rows.length
  }

  if (role === 'admin' && workspaceWasEmpty && localRecords.length > 0) {
    const rows = localRecords.map((record) => ({
      id: record.id,
      workspace_id: workspaceId,
      business_date: record.date,
      created_at: record.createdAt,
      total_cents: record.totalCents,
      payload: record,
      created_by: user.id,
    }))
    const { error } = await client.from('tip_records').upsert(rows, {
      onConflict: 'workspace_id,business_date',
      ignoreDuplicates: true,
    })
    if (error) throw new Error(`Could not import local history: ${error.message}`)
    migratedRecords = rows.length
  }

  return {
    snapshot: await loadWorkspaceSnapshot(workspaceId),
    migratedEmployees,
    migratedRecords,
  }
}

export async function createCloudEmployee(workspaceId: string, employee: StoredEmployee): Promise<void> {
  const client = requireClient()
  const { error } = await client.from('employees').insert({
    id: employee.id,
    workspace_id: workspaceId,
    name: employee.name,
  })
  if (error) throw new Error(`Could not add employee: ${error.message}`)
}

export async function deleteCloudEmployee(workspaceId: string, employeeId: string): Promise<void> {
  const client = requireClient()
  const { error } = await client.from('employees').delete().eq('workspace_id', workspaceId).eq('id', employeeId)
  if (error) throw new Error(`Could not remove employee: ${error.message}`)
}

export async function createCloudTipRecord(workspaceId: string, user: User, record: TipRecord): Promise<void> {
  const client = requireClient()
  const { error } = await client.from('tip_records').insert({
    id: record.id,
    workspace_id: workspaceId,
    business_date: record.date,
    created_at: record.createdAt,
    total_cents: record.totalCents,
    payload: record,
    created_by: user.id,
  })
  if (error) {
    if (error.code === '23505') {
      throw new Error('A distribution already exists for this date in the shared workspace. Refresh the history before trying again.')
    }
    throw new Error(`Could not save distribution to the shared database: ${error.message}`)
  }
}

export async function deleteCloudTipRecord(workspaceId: string, recordId: string): Promise<void> {
  const client = requireClient()
  const { error } = await client.from('tip_records').delete().eq('workspace_id', workspaceId).eq('id', recordId)
  if (error) throw new Error(`Could not delete the shared record: ${error.message}`)
}



export function subscribeToWorkspaceChanges(workspaceId: string, onChange: () => void) {
  const client = requireClient()
  return client
    .channel(`tipsplit-${workspaceId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `workspace_id=eq.${workspaceId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tip_records', filter: `workspace_id=eq.${workspaceId}` }, onChange)
    .subscribe()
}
