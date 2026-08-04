begin;

alter table public.meal_plans
  add column if not exists plan_type text;

update public.meal_plans
set plan_type = 'recipe'
where plan_type is null;

alter table public.meal_plans
  alter column plan_type set default 'recipe',
  alter column plan_type set not null,
  alter column recipe_id drop not null;

do $$
declare
  check_name text;
begin
  for check_name in
    select constraint_row.conname
    from pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.meal_plans'::regclass
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) ~* '(day_index|assigned_cook|plan_type)'
  loop
    execute format('alter table public.meal_plans drop constraint %I', check_name);
  end loop;
end
$$;

alter table public.meal_plans
  add constraint meal_plans_day_index_check
    check (day_index between 0 and 6),
  add constraint meal_plans_plan_type_check
    check (plan_type in ('recipe', 'eat_out')),
  add constraint meal_plans_assigned_cook_check
    check (assigned_cook in ('Kate', 'Oscar', 'Either', 'Eating Out')),
  add constraint meal_plans_plan_consistency_check
    check (
      (
        plan_type = 'recipe'
        and recipe_id is not null
        and assigned_cook in ('Kate', 'Oscar', 'Either')
      )
      or
      (
        plan_type = 'eat_out'
        and recipe_id is null
        and assigned_cook = 'Eating Out'
      )
    );

commit;
