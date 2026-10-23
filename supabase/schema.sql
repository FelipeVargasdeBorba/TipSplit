-- TipSplit workspace, account membership, and row-level security.
-- Run this entire script in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'supervisor')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.employees (
  id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  is_supervisor boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.tip_records (
  id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  business_date date not null,
  created_at timestamptz not null,
  total_cents bigint not null check (total_cents >= 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  primary key (workspace_id, id)
);

create index if not exists tip_records_workspace_date_idx
  on public.tip_records (workspace_id, business_date desc);

-- Fixed workspace ID for this TipSplit database. Copy the same ID to .env.local.
insert into public.workspaces (id, name)
values ('b4f4c574-6f44-4ed0-a9cd-a1c6f50fcd10', 'Café en Seine')
on conflict (id) do nothing;

-- SECURITY DEFINER avoids recursive RLS checks when a policy checks membership.
create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.is_workspace_member(uuid) from anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;

create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = (select auth.uid())
      and wm.role = 'admin'
  );
$$;

revoke all on function public.is_workspace_admin(uuid) from public;
revoke all on function public.is_workspace_admin(uuid) from anon;
grant execute on function public.is_workspace_admin(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.employees enable row level security;
alter table public.tip_records enable row level security;

-- Re-create policies idempotently so the setup script can safely be run again.
drop policy if exists "Members can view their workspace" on public.workspaces;
create policy "Members can view their workspace"
  on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));

drop policy if exists "Users can view their own membership" on public.workspace_members;
create policy "Users can view their own membership"
  on public.workspace_members for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Workspace members can view employees" on public.employees;
create policy "Workspace members can view employees"
  on public.employees for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "Workspace admins can manage employees" on public.employees;
create policy "Workspace admins can manage employees"
  on public.employees for all to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

drop policy if exists "Workspace members can view tip records" on public.tip_records;
create policy "Workspace members can view tip records"
  on public.tip_records for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "Workspace members can create tip records" on public.tip_records;
create policy "Workspace members can create tip records"
  on public.tip_records for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "Workspace admins can delete tip records" on public.tip_records;
create policy "Workspace admins can delete tip records"
  on public.tip_records for delete to authenticated
  using (public.is_workspace_admin(workspace_id));

-- Explicit grants: RLS filters rows; grants determine which operations roles may attempt.
grant usage on schema public to authenticated;
revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
revoke all on public.employees from anon, authenticated;
revoke all on public.tip_records from anon, authenticated;

grant select on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, insert, update, delete on public.employees to authenticated;
grant select, insert, delete on public.tip_records to authenticated;

-- Enable live change notifications where the standard Supabase publication exists.
-- App still refreshes on focus and periodically if Realtime is unavailable.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'employees') then
      execute 'alter publication supabase_realtime add table public.employees';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tip_records') then
      execute 'alter publication supabase_realtime add table public.tip_records';
    end if;
  end if;
end $$;
