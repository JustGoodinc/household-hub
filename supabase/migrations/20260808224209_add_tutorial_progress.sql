begin;

alter table public.household_members
  add column if not exists tutorial_prompt_seen boolean not null default false,
  add column if not exists tutorial_completed boolean not null default false,
  add column if not exists tutorial_completed_at timestamptz;

update public.household_members
set tutorial_prompt_seen = coalesce(tutorial_prompt_seen, false),
    tutorial_completed = coalesce(tutorial_completed, false)
where tutorial_prompt_seen is null
   or tutorial_completed is null;

alter table public.household_members
  alter column tutorial_prompt_seen set default false,
  alter column tutorial_prompt_seen set not null,
  alter column tutorial_completed set default false,
  alter column tutorial_completed set not null;

revoke update on table public.household_members
  from public, anon, authenticated;
revoke update (tutorial_prompt_seen, tutorial_completed, tutorial_completed_at)
  on table public.household_members
  from public, anon, authenticated;

create or replace function public.update_tutorial_status(
  p_prompt_seen boolean default null,
  p_completed boolean default null
)
returns table (
  tutorial_prompt_seen boolean,
  tutorial_completed boolean,
  tutorial_completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  if not coalesce(p_prompt_seen, false)
     and not coalesce(p_completed, false) then
    raise exception 'A tutorial status update is required.' using errcode = '22023';
  end if;

  return query
  update public.household_members as member
  set tutorial_prompt_seen = member.tutorial_prompt_seen
        or coalesce(p_prompt_seen, false)
        or coalesce(p_completed, false),
      tutorial_completed = member.tutorial_completed or coalesce(p_completed, false),
      tutorial_completed_at = case
        when p_completed is true then now()
        else member.tutorial_completed_at
      end
  where member.user_id = v_user_id
  returning member.tutorial_prompt_seen,
            member.tutorial_completed,
            member.tutorial_completed_at;

  if not found then
    raise exception 'Household membership not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.update_tutorial_status(boolean, boolean) from public;
revoke all on function public.update_tutorial_status(boolean, boolean) from anon;
grant execute on function public.update_tutorial_status(boolean, boolean) to authenticated;

commit;
