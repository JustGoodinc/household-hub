-- OUR HOUSEHOLD HUB - SUPABASE DATABASE SETUP
-- Run this entire file once in Supabase: SQL Editor > New query > Run.
-- It creates the tables, secure access rules, and household invite functions.

begin;

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  invite_code text not null unique check (char_length(invite_code) = 10),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  category text not null check (category in ('food', 'gas', 'utilities')),
  purchase_date date not null default current_date,
  purchased_by text not null check (char_length(trim(purchased_by)) between 1 and 40),
  store text check (store is null or char_length(store) <= 80),
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 100),
  can_cook text[] not null,
  ingredients text,
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(can_cook) > 0),
  check (can_cook <@ array['Kate', 'Oscar']::text[])
);

create unique index if not exists recipes_household_name_unique
  on public.recipes (household_id, lower(name));

create table if not exists public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null,
  day_index smallint not null check (day_index between 0 and 4),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  assigned_cook text not null check (assigned_cook in ('Kate', 'Oscar', 'Either')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (household_id, week_start, day_index)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists purchases_set_updated_at on public.purchases;
create trigger purchases_set_updated_at
before update on public.purchases
for each row execute function public.set_updated_at();

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at
before update on public.recipes
for each row execute function public.set_updated_at();

-- This helper prevents recursive Row Level Security policies.
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

create or replace function public.create_household(p_name text, p_display_name text)
returns table (household_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_invite_code text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a household.';
  end if;

  if char_length(trim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'Enter a household name.';
  end if;

  if char_length(trim(coalesce(p_display_name, ''))) not between 1 and 40 then
    raise exception 'Enter your display name.';
  end if;

  loop
    v_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.households where households.invite_code = v_invite_code);
  end loop;

  insert into public.households (name, invite_code, created_by)
  values (trim(p_name), v_invite_code, auth.uid())
  returning id into v_household_id;

  insert into public.household_members (household_id, user_id, display_name, role)
  values (v_household_id, auth.uid(), trim(p_display_name), 'owner');

  return query select v_household_id, v_invite_code;
end;
$$;

create or replace function public.join_household(p_invite_code text, p_display_name text)
returns table (household_id uuid, household_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
  v_household_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a household.';
  end if;

  if char_length(trim(coalesce(p_display_name, ''))) not between 1 and 40 then
    raise exception 'Enter your display name.';
  end if;

  select h.id, h.name
    into v_household_id, v_household_name
  from public.households h
  where h.invite_code = upper(trim(p_invite_code));

  if v_household_id is null then
    raise exception 'Invite code not found.';
  end if;

  if (select count(*) from public.household_members where household_id = v_household_id) >= 2 then
    raise exception 'This household already has two members.';
  end if;

  insert into public.household_members (household_id, user_id, display_name, role)
  values (v_household_id, auth.uid(), trim(p_display_name), 'member');

  return query select v_household_id, v_household_name;
end;
$$;

revoke all on function public.create_household(text, text) from public;
revoke all on function public.join_household(text, text) from public;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.purchases enable row level security;
alter table public.recipes enable row level security;
alter table public.meal_plans enable row level security;

drop policy if exists "Members can view household" on public.households;
create policy "Members can view household"
on public.households for select
to authenticated
using (public.is_household_member(id));

drop policy if exists "Members can view household members" on public.household_members;
create policy "Members can view household members"
on public.household_members for select
to authenticated
using (public.is_household_member(household_id));

drop policy if exists "Members can view purchases" on public.purchases;
create policy "Members can view purchases"
on public.purchases for select
to authenticated
using (public.is_household_member(household_id));

drop policy if exists "Members can add purchases" on public.purchases;
create policy "Members can add purchases"
on public.purchases for insert
to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists "Members can update purchases" on public.purchases;
create policy "Members can update purchases"
on public.purchases for update
to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "Members can delete purchases" on public.purchases;
create policy "Members can delete purchases"
on public.purchases for delete
to authenticated
using (public.is_household_member(household_id));

drop policy if exists "Members can view recipes" on public.recipes;
create policy "Members can view recipes"
on public.recipes for select
to authenticated
using (public.is_household_member(household_id));

drop policy if exists "Members can add recipes" on public.recipes;
create policy "Members can add recipes"
on public.recipes for insert
to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists "Members can update recipes" on public.recipes;
create policy "Members can update recipes"
on public.recipes for update
to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "Members can delete recipes" on public.recipes;
create policy "Members can delete recipes"
on public.recipes for delete
to authenticated
using (public.is_household_member(household_id));

drop policy if exists "Members can view meal plans" on public.meal_plans;
create policy "Members can view meal plans"
on public.meal_plans for select
to authenticated
using (public.is_household_member(household_id));

drop policy if exists "Members can add meal plans" on public.meal_plans;
create policy "Members can add meal plans"
on public.meal_plans for insert
to authenticated
with check (public.is_household_member(household_id) and created_by = auth.uid());

drop policy if exists "Members can update meal plans" on public.meal_plans;
create policy "Members can update meal plans"
on public.meal_plans for update
to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "Members can delete meal plans" on public.meal_plans;
create policy "Members can delete meal plans"
on public.meal_plans for delete
to authenticated
using (public.is_household_member(household_id));

revoke all on public.households, public.household_members, public.purchases, public.recipes, public.meal_plans from anon;
grant select on public.households, public.household_members to authenticated;
grant select, insert, update, delete on public.purchases, public.recipes, public.meal_plans to authenticated;

commit;
