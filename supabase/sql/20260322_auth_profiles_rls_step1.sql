-- Step 1 for Supabase Auth + RLS migration.
-- Applies the auth/profile/access schema, compact JWT hook, helper functions,
-- and the first RLS-safe slice for Company, Bank, Marka, and PaymentMode.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  legacy_user_id text unique,
  trader_id text not null references public."Trader"(id) on delete cascade,
  user_code text not null,
  full_name text,
  app_role text not null check (app_role in ('super_admin', 'trader_admin', 'company_admin', 'company_user')),
  login_email text not null unique,
  default_company_id text references public."Company"(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (trader_id, user_code)
);

create table if not exists public.profile_company_access (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id text not null references public."Company"(id) on delete cascade,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (profile_id, company_id)
);

create table if not exists public.profile_company_permissions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id text not null references public."Company"(id) on delete cascade,
  module text not null,
  can_read boolean not null default false,
  can_write boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (profile_id, company_id, module)
);

create index if not exists idx_profiles_trader_role on public.profiles(trader_id, app_role);
create index if not exists idx_profile_company_access_company on public.profile_company_access(company_id);
create index if not exists idx_profile_company_permissions_lookup on public.profile_company_permissions(profile_id, company_id, module);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists profile_company_access_set_updated_at on public.profile_company_access;
create trigger profile_company_access_set_updated_at
before update on public.profile_company_access
for each row
execute function public.set_updated_at();

drop trigger if exists profile_company_permissions_set_updated_at on public.profile_company_permissions;
create trigger profile_company_permissions_set_updated_at
before update on public.profile_company_permissions
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  metadata jsonb;
begin
  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  insert into public.profiles (
    id,
    legacy_user_id,
    trader_id,
    user_code,
    full_name,
    app_role,
    login_email,
    default_company_id,
    is_active
  )
  values (
    new.id,
    nullif(metadata->>'legacy_user_id', ''),
    metadata->>'trader_id',
    metadata->>'user_code',
    nullif(metadata->>'full_name', ''),
    coalesce(nullif(metadata->>'app_role', ''), 'company_user'),
    coalesce(new.email, metadata->>'login_email'),
    nullif(metadata->>'default_company_id', ''),
    true
  )
  on conflict (id) do update
  set
    legacy_user_id = excluded.legacy_user_id,
    trader_id = excluded.trader_id,
    user_code = excluded.user_code,
    full_name = excluded.full_name,
    app_role = excluded.app_role,
    login_email = excluded.login_email,
    default_company_id = excluded.default_company_id,
    is_active = true;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update on auth.users
for each row
execute function public.handle_new_auth_user();

create or replace function public.jwt_claim_text(claim_key text)
returns text
language sql
stable
as $$
  select auth.jwt() ->> claim_key
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
as $$
  select coalesce(public.jwt_claim_text('app_role'), '')
$$;

create or replace function public.current_trader_id()
returns text
language sql
stable
as $$
  select public.jwt_claim_text('trader_id')
$$;

create or replace function public.current_user_db_id()
returns text
language sql
stable
as $$
  select public.jwt_claim_text('user_db_id')
$$;

create or replace function public.current_default_company_id()
returns text
language sql
stable
as $$
  select public.jwt_claim_text('default_company_id')
$$;

create or replace function public.current_company_ids()
returns text[]
language sql
stable
as $$
  select coalesce(
    array(
      select jsonb_array_elements_text(
        coalesce(auth.jwt() -> 'company_ids', '[]'::jsonb)
      )
    ),
    array[]::text[]
  )
$$;

create or replace function public.has_company_access(target_company_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if public.current_app_role() = 'super_admin' then
    return exists(
      select 1
      from public."Company" c
      where c.id = target_company_id
        and c."deletedAt" is null
    );
  end if;

  if public.current_app_role() = 'trader_admin' then
    return exists(
      select 1
      from public."Company" c
      where c.id = target_company_id
        and c."deletedAt" is null
        and (c."traderId" = public.current_trader_id() or c."traderId" is null)
    );
  end if;

  if target_company_id = public.current_default_company_id() then
    return true;
  end if;

  if target_company_id = any(public.current_company_ids()) then
    return true;
  end if;

  return exists(
    select 1
    from public.profile_company_access pca
    join public."Company" c
      on c.id = pca.company_id
    where pca.profile_id = auth.uid()
      and pca.company_id = target_company_id
      and pca.is_active = true
      and c."deletedAt" is null
      and (c."traderId" = public.current_trader_id() or c."traderId" is null)
  );
end;
$$;

create or replace function public.has_company_module_access(
  target_company_id text,
  requested_module text,
  requested_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_company_access(target_company_id) then
    return false;
  end if;

  if public.current_app_role() = 'super_admin' then
    return true;
  end if;

  return exists(
    select 1
    from public.profile_company_permissions pcp
    where pcp.profile_id = auth.uid()
      and pcp.company_id = target_company_id
      and pcp.module = requested_module
      and (
        case
          when requested_action = 'write' then pcp.can_write
          else pcp.can_read or pcp.can_write
        end
      )
  );
end;
$$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  claims jsonb;
  profile_row public.profiles%rowtype;
  granted_company_ids text[];
  total_company_id_length integer := 0;
begin
  select *
    into profile_row
  from public.profiles
  where id = (event->>'user_id')::uuid
    and is_active = true;

  claims := coalesce(event->'claims', '{}'::jsonb);

  if profile_row.id is null then
    claims := jsonb_set(claims, '{app_role}', 'null'::jsonb, true);
    claims := jsonb_set(claims, '{trader_id}', 'null'::jsonb, true);
    claims := jsonb_set(claims, '{user_db_id}', 'null'::jsonb, true);
    claims := jsonb_set(claims, '{default_company_id}', 'null'::jsonb, true);
    claims := claims - 'company_ids';
    return jsonb_set(event, '{claims}', claims, true);
  end if;

  claims := jsonb_set(claims, '{app_role}', to_jsonb(profile_row.app_role), true);
  claims := jsonb_set(claims, '{trader_id}', to_jsonb(profile_row.trader_id), true);
  claims := jsonb_set(claims, '{user_db_id}', to_jsonb(coalesce(profile_row.legacy_user_id, profile_row.id::text)), true);
  claims := jsonb_set(claims, '{default_company_id}', to_jsonb(profile_row.default_company_id), true);

  select coalesce(array_agg(company_id order by company_id), array[]::text[])
    into granted_company_ids
  from public.profile_company_access
  where profile_id = profile_row.id
    and is_active = true;

  select coalesce(sum(length(company_id)), 0)
    into total_company_id_length
  from public.profile_company_access
  where profile_id = profile_row.id
    and is_active = true;

  if array_length(granted_company_ids, 1) is not null
     and array_length(granted_company_ids, 1) <= 25
     and total_company_id_length <= 1200 then
    claims := jsonb_set(claims, '{company_ids}', to_jsonb(granted_company_ids), true);
  else
    claims := claims - 'company_ids';
  end if;

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

grant select, insert, update on public.profiles to supabase_auth_admin;
grant select, insert, update on public.profile_company_access to supabase_auth_admin;
grant select, insert, update on public.profile_company_permissions to supabase_auth_admin;
revoke all on public.profiles from authenticated, anon, public;
revoke all on public.profile_company_access from authenticated, anon, public;
revoke all on public.profile_company_permissions from authenticated, anon, public;

alter table public.profiles enable row level security;
alter table public.profile_company_access enable row level security;
alter table public.profile_company_permissions enable row level security;

drop policy if exists "profiles self select" on public.profiles;
create policy "profiles self select"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "profiles auth admin read" on public.profiles;
create policy "profiles auth admin read"
on public.profiles
for select
to supabase_auth_admin
using (true);

drop policy if exists "profile company access self select" on public.profile_company_access;
create policy "profile company access self select"
on public.profile_company_access
for select
to authenticated
using (profile_id = auth.uid());

drop policy if exists "profile company access auth admin read" on public.profile_company_access;
create policy "profile company access auth admin read"
on public.profile_company_access
for select
to supabase_auth_admin
using (true);

drop policy if exists "profile company permissions self select" on public.profile_company_permissions;
create policy "profile company permissions self select"
on public.profile_company_permissions
for select
to authenticated
using (profile_id = auth.uid());

drop policy if exists "profile company permissions auth admin read" on public.profile_company_permissions;
create policy "profile company permissions auth admin read"
on public.profile_company_permissions
for select
to supabase_auth_admin
using (true);

alter table public."Company" enable row level security;
alter table public."Bank" enable row level security;
alter table public."Marka" enable row level security;
alter table public."PaymentMode" enable row level security;

drop policy if exists "company select scoped" on public."Company";
create policy "company select scoped"
on public."Company"
for select
to authenticated
using (
  public.has_company_access(id)
  and "deletedAt" is null
);

drop policy if exists "company insert scoped" on public."Company";
create policy "company insert scoped"
on public."Company"
for insert
to authenticated
with check (
  public.current_app_role() = 'super_admin'
  or (
    public.current_app_role() = 'trader_admin'
    and ("traderId" = public.current_trader_id() or "traderId" is null)
  )
);

drop policy if exists "company update scoped" on public."Company";
create policy "company update scoped"
on public."Company"
for update
to authenticated
using (
  public.current_app_role() = 'super_admin'
  or (
    public.current_app_role() = 'trader_admin'
    and public.has_company_access(id)
    and ("traderId" = public.current_trader_id() or "traderId" is null)
  )
)
with check (
  public.current_app_role() = 'super_admin'
  or (
    public.current_app_role() = 'trader_admin'
    and ("traderId" = public.current_trader_id() or "traderId" is null)
  )
);

drop policy if exists "company delete scoped" on public."Company";
create policy "company delete scoped"
on public."Company"
for delete
to authenticated
using (
  public.current_app_role() = 'super_admin'
  or (
    public.current_app_role() = 'trader_admin'
    and public.has_company_access(id)
    and ("traderId" = public.current_trader_id() or "traderId" is null)
  )
);

drop policy if exists "bank select scoped" on public."Bank";
create policy "bank select scoped"
on public."Bank"
for select
to authenticated
using (public.has_company_module_access("companyId", 'MASTER_BANK', 'read'));

drop policy if exists "bank insert scoped" on public."Bank";
create policy "bank insert scoped"
on public."Bank"
for insert
to authenticated
with check (public.has_company_module_access("companyId", 'MASTER_BANK', 'write'));

drop policy if exists "bank update scoped" on public."Bank";
create policy "bank update scoped"
on public."Bank"
for update
to authenticated
using (public.has_company_module_access("companyId", 'MASTER_BANK', 'write'))
with check (public.has_company_module_access("companyId", 'MASTER_BANK', 'write'));

drop policy if exists "bank delete scoped" on public."Bank";
create policy "bank delete scoped"
on public."Bank"
for delete
to authenticated
using (public.has_company_module_access("companyId", 'MASTER_BANK', 'write'));

drop policy if exists "marka select scoped" on public."Marka";
create policy "marka select scoped"
on public."Marka"
for select
to authenticated
using (public.has_company_module_access("companyId", 'MASTER_MARKA', 'read'));

drop policy if exists "marka insert scoped" on public."Marka";
create policy "marka insert scoped"
on public."Marka"
for insert
to authenticated
with check (public.has_company_module_access("companyId", 'MASTER_MARKA', 'write'));

drop policy if exists "marka update scoped" on public."Marka";
create policy "marka update scoped"
on public."Marka"
for update
to authenticated
using (public.has_company_module_access("companyId", 'MASTER_MARKA', 'write'))
with check (public.has_company_module_access("companyId", 'MASTER_MARKA', 'write'));

drop policy if exists "marka delete scoped" on public."Marka";
create policy "marka delete scoped"
on public."Marka"
for delete
to authenticated
using (public.has_company_module_access("companyId", 'MASTER_MARKA', 'write'));

drop policy if exists "payment mode select scoped" on public."PaymentMode";
create policy "payment mode select scoped"
on public."PaymentMode"
for select
to authenticated
using (public.has_company_module_access("companyId", 'MASTER_PAYMENT_MODE', 'read'));

drop policy if exists "payment mode insert scoped" on public."PaymentMode";
create policy "payment mode insert scoped"
on public."PaymentMode"
for insert
to authenticated
with check (public.has_company_module_access("companyId", 'MASTER_PAYMENT_MODE', 'write'));

drop policy if exists "payment mode update scoped" on public."PaymentMode";
create policy "payment mode update scoped"
on public."PaymentMode"
for update
to authenticated
using (public.has_company_module_access("companyId", 'MASTER_PAYMENT_MODE', 'write'))
with check (public.has_company_module_access("companyId", 'MASTER_PAYMENT_MODE', 'write'));

drop policy if exists "payment mode delete scoped" on public."PaymentMode";
create policy "payment mode delete scoped"
on public."PaymentMode"
for delete
to authenticated
using (public.has_company_module_access("companyId", 'MASTER_PAYMENT_MODE', 'write'));
