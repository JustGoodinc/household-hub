begin;

alter table public.purchases
  drop constraint if exists purchases_category_check;

alter table public.purchases
  add constraint purchases_category_check
  check (category in ('food', 'gas', 'utilities', 'house_bills'));

commit;
