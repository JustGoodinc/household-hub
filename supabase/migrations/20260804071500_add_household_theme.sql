begin;

alter table public.households
  add column if not exists theme text not null default 'forest';

update public.households
set theme = 'forest'
where theme is null;

alter table public.households
  alter column theme set default 'forest',
  alter column theme set not null;

alter table public.households
  drop constraint if exists households_theme_check;

alter table public.households
  add constraint households_theme_check
  check (theme in (
    'forest',
    'berry',
    'sunset',
    'mint',
    'sky_night',
    'desert',
    'ocean',
    'lemon',
    'lavender'
  ));

revoke update on table public.households from public, anon, authenticated;
revoke update (theme) on table public.households from public, anon, authenticated;

create or replace function public.update_household_theme(p_theme text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_household_id uuid;
  v_saved_theme text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  if p_theme is null or p_theme not in (
    'forest',
    'berry',
    'sunset',
    'mint',
    'sky_night',
    'desert',
    'ocean',
    'lemon',
    'lavender'
  ) then
    raise exception 'Invalid household theme.' using errcode = '22023';
  end if;

  select household_member.household_id
  into v_household_id
  from public.household_members as household_member
  where household_member.user_id = v_user_id
    and household_member.role = 'owner'
  limit 1;

  if v_household_id is null then
    raise exception 'Only the household owner can change the theme.' using errcode = '42501';
  end if;

  update public.households
  set theme = p_theme
  where id = v_household_id
  returning theme into v_saved_theme;

  if v_saved_theme is null then
    raise exception 'Household not found.' using errcode = 'P0002';
  end if;

  return v_saved_theme;
end;
$$;

revoke all on function public.update_household_theme(text) from public;
revoke all on function public.update_household_theme(text) from anon;
grant execute on function public.update_household_theme(text) to authenticated;

commit;
