-- D13A: commercial percentage rates are stored canonically as fractions.
-- Existing rows are not rewritten. The trigger validates only inserts and
-- changes to the relevant type/value pair, so unrelated edits to historical
-- rows remain possible even if an old value predates this rule.

begin;

create or replace function public.enforce_fractional_merchant_rates()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.merchant_commission_type = 'percentage'
     and (tg_op = 'INSERT'
          or new.merchant_commission_type is distinct from old.merchant_commission_type
          or new.merchant_commission_value is distinct from old.merchant_commission_value)
     and new.merchant_commission_value is not null
     and (new.merchant_commission_value < 0 or new.merchant_commission_value > 1) then
    raise exception 'merchant_commission_value must be a fraction between 0 and 1 for percentage rates'
      using errcode = '23514';
  end if;

  if new.merchant_discount_type = 'percentage'
     and (tg_op = 'INSERT'
          or new.merchant_discount_type is distinct from old.merchant_discount_type
          or new.merchant_discount_value is distinct from old.merchant_discount_value)
     and new.merchant_discount_value is not null
     and (new.merchant_discount_value < 0 or new.merchant_discount_value > 1) then
    raise exception 'merchant_discount_value must be a fraction between 0 and 1 for percentage rates'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_fractional_merchant_rates() from public, anon, authenticated;

drop trigger if exists merchant_details_fractional_rates_trg on public.merchant_details;
create trigger merchant_details_fractional_rates_trg
before insert or update of
  merchant_commission_type,
  merchant_commission_value,
  merchant_discount_type,
  merchant_discount_value
on public.merchant_details
for each row execute function public.enforce_fractional_merchant_rates();

comment on function public.enforce_fractional_merchant_rates() is
  'D13A: validates newly inserted or changed percentage rates as fractions in [0,1] without rewriting historical rows.';

commit;
