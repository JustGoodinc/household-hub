begin;

alter table public.household_members
  add column if not exists purchase_summaries_enabled boolean not null default true,
  add column if not exists purchase_summary_last_checked_at timestamptz;

update public.household_members
set purchase_summaries_enabled = true
where purchase_summaries_enabled is null;

alter table public.household_members
  alter column purchase_summaries_enabled set default true,
  alter column purchase_summaries_enabled set not null;

revoke update on table public.household_members from public, anon, authenticated;
revoke update (purchase_summaries_enabled, purchase_summary_last_checked_at)
  on table public.household_members
  from public, anon, authenticated;

create or replace function public.update_purchase_summary_preference(p_enabled boolean)
returns table (enabled boolean, last_checked_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  if p_enabled is null then
    raise exception 'Purchase summary preference is required.' using errcode = '22004';
  end if;

  return query
  update public.household_members as member
  set purchase_summaries_enabled = p_enabled,
      purchase_summary_last_checked_at = case
        when p_enabled then now()
        else member.purchase_summary_last_checked_at
      end
  where member.user_id = v_user_id
  returning member.purchase_summaries_enabled,
            member.purchase_summary_last_checked_at;

  if not found then
    raise exception 'Household membership not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.update_purchase_summary_checkpoint(p_checked_at timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_saved_checkpoint timestamptz;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  if p_checked_at is null then
    raise exception 'Purchase summary checkpoint is required.' using errcode = '22004';
  end if;

  if p_checked_at > now() + interval '5 minutes' then
    raise exception 'Purchase summary checkpoint cannot be in the future.' using errcode = '22023';
  end if;

  update public.household_members as member
  set purchase_summary_last_checked_at = p_checked_at
  where member.user_id = v_user_id
  returning member.purchase_summary_last_checked_at into v_saved_checkpoint;

  if v_saved_checkpoint is null then
    raise exception 'Household membership not found.' using errcode = 'P0002';
  end if;

  return v_saved_checkpoint;
end;
$$;

revoke all on function public.update_purchase_summary_preference(boolean) from public;
revoke all on function public.update_purchase_summary_preference(boolean) from anon;
revoke all on function public.update_purchase_summary_checkpoint(timestamptz) from public;
revoke all on function public.update_purchase_summary_checkpoint(timestamptz) from anon;

grant execute on function public.update_purchase_summary_preference(boolean) to authenticated;
grant execute on function public.update_purchase_summary_checkpoint(timestamptz) to authenticated;

commit;
