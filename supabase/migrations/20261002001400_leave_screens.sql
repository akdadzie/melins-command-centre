-- =============================================================================
-- 1400 Leave screens (brief §7.3; A-038)
--  * working_days(): the request form shows how many working days a request
--    takes before it's saved (weekends and public holidays excluded).
--  * set_up_leave_year(): the Owner creates a leave year's entitlements from
--    each leave type's default days, pro-rated for people joining or leaving
--    during the year, with annual leave carried over up to the Settings cap.
-- =============================================================================

create or replace function public.working_days(p_start date, p_end date) returns int
language sql stable security definer set search_path = '' as $$
  select case when app.my_role() is not null and p_end >= p_start and p_end - p_start <= 400
              then app.working_days_in(p_start, p_end) end
$$;

-- Returns the number of entitlements created. Existing rows are never changed,
-- so running it again only adds people or leave types that were missing.
create or replace function public.set_up_leave_year(p_year int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings_versions;
  y_start date;
  y_end date;
  n int;
begin
  if not app.has_role('owner') then
    raise exception 'Only the Owner sets leave entitlements' using errcode = '42501';
  end if;
  y_start := make_date(p_year, (app.settings_at(make_date(p_year, 12, 31))).leave_year_start_month, 1);
  y_end := (y_start + interval '1 year' - interval '1 day')::date;
  s := app.settings_at(y_start);

  insert into public.leave_entitlements (staff_id, leave_type_id, leave_year, entitled_days, carried_over_days, notes)
  select st.id, lt.id, p_year,
         -- days employed in the leave year / days in the year, to the nearest half day
         round(lt.default_entitled_days * 2
               * (least(coalesce(st.end_date, y_end), y_end) - greatest(st.start_date, y_start) + 1)
               / (y_end - y_start + 1)) / 2,
         case when lt.uses_annual_balance
              then least(coalesce(s.max_carry_over_days, 0),
                         greatest((app.leave_balance(st.id, lt.id, p_year - 1)).available, 0))
              else 0 end,
         case when st.start_date > y_start or coalesce(st.end_date, y_end) < y_end
              then 'Pro-rated for the dates employed' end
  from public.staff st
  cross join public.leave_types lt
  where st.is_active and lt.is_active and lt.default_entitled_days is not null
    and st.start_date <= y_end and (st.end_date is null or st.end_date >= y_start)
    and not exists (select 1 from public.leave_entitlements e
                    where e.staff_id = st.id and e.leave_type_id = lt.id and e.leave_year = p_year);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.set_up_leave_year(int) from public, anon;
revoke execute on function public.working_days(date, date) from public, anon;
grant execute on function public.set_up_leave_year(int) to authenticated;
grant execute on function public.working_days(date, date) to authenticated;
