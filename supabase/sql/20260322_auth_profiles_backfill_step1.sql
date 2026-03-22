-- Step 1 backfill for Supabase Auth + RLS migration.
-- Run this after:
-- 1. Applying 20260322_auth_profiles_rls_step1.sql
-- 2. Creating/auth-migrating Supabase auth.users rows
-- 3. Ensuring public.profiles.legacy_user_id matches public."User".id

update public.profiles p
set default_company_id = u."companyId"
from public."User" u
where p.legacy_user_id = u.id
  and u."deletedAt" is null
  and u."companyId" is not null
  and (
    p.default_company_id is distinct from u."companyId"
    or p.default_company_id is null
  );

insert into public.profile_company_access (
  profile_id,
  company_id,
  is_default,
  is_active
)
select
  p.id,
  u."companyId",
  true,
  true
from public.profiles p
join public."User" u
  on u.id = p.legacy_user_id
where u."deletedAt" is null
  and u."companyId" is not null
on conflict (profile_id, company_id) do update
set
  is_default = true,
  is_active = true,
  updated_at = timezone('utc', now());

insert into public.profile_company_access (
  profile_id,
  company_id,
  is_default,
  is_active
)
select distinct
  p.id,
  up."companyId",
  false,
  true
from public.profiles p
join public."User" u
  on u.id = p.legacy_user_id
join public."UserPermission" up
  on up."userId" = u.id
join public."Company" c
  on c.id = up."companyId"
where u."deletedAt" is null
  and c."deletedAt" is null
  and (up."canRead" = true or up."canWrite" = true)
  and (c."traderId" = p.trader_id or c."traderId" is null)
on conflict (profile_id, company_id) do update
set
  is_active = true,
  updated_at = timezone('utc', now());

insert into public.profile_company_access (
  profile_id,
  company_id,
  is_default,
  is_active
)
select
  p.id,
  c.id,
  (c.id = p.default_company_id),
  true
from public.profiles p
join public."Company" c
  on c."deletedAt" is null
where p.app_role = 'trader_admin'
  and (c."traderId" = p.trader_id or c."traderId" is null)
on conflict (profile_id, company_id) do update
set
  is_active = true,
  updated_at = timezone('utc', now());

insert into public.profile_company_access (
  profile_id,
  company_id,
  is_default,
  is_active
)
select
  p.id,
  c.id,
  (c.id = p.default_company_id),
  true
from public.profiles p
join public."Company" c
  on c."deletedAt" is null
where p.app_role = 'super_admin'
on conflict (profile_id, company_id) do update
set
  is_active = true,
  updated_at = timezone('utc', now());

insert into public.profile_company_permissions (
  profile_id,
  company_id,
  module,
  can_read,
  can_write
)
select
  p.id,
  up."companyId",
  up.module,
  up."canRead",
  up."canWrite"
from public.profiles p
join public."User" u
  on u.id = p.legacy_user_id
join public."UserPermission" up
  on up."userId" = u.id
join public."Company" c
  on c.id = up."companyId"
where u."deletedAt" is null
  and c."deletedAt" is null
  and (c."traderId" = p.trader_id or c."traderId" is null)
on conflict (profile_id, company_id, module) do update
set
  can_read = excluded.can_read,
  can_write = excluded.can_write,
  updated_at = timezone('utc', now());

update public.profile_company_access pca
set
  is_default = (pca.company_id = p.default_company_id),
  updated_at = timezone('utc', now())
from public.profiles p
where p.id = pca.profile_id;

with first_company as (
  select distinct on (profile_id)
    profile_id,
    company_id
  from public.profile_company_access
  where is_active = true
  order by profile_id, is_default desc, company_id asc
)
update public.profiles p
set
  default_company_id = fc.company_id,
  updated_at = timezone('utc', now())
from first_company fc
where p.id = fc.profile_id
  and p.default_company_id is null;
