-- =============================================================================
-- 0900 Reference data (brief §7.1, §7.3, §11). A migration, not seed.sql,
-- because staging and production both need it. Never guessed: tax and WHT
-- rates, TIN / VAT number, Tier 2 trustee, per diems, bonus base, accounts,
-- public holiday dates (all entered in the setup wizard).
-- =============================================================================

-- Directors (brief §2). The Owner's profile is linked when the Owner signs up.
insert into public.directors (full_name, is_owner) values
  ('Kwasi Dadzie Ennison', true),
  ('Kofi Anaman', false),
  ('Ransford Addai', false);

-- Budget roles (D-014). Admin time is non-billable by default.
insert into public.budget_roles (name, billable_default, sort_order) values
  ('Managing Director', true, 1),
  ('Senior Engineer', true, 2),
  ('Graduate Engineer', true, 3),
  ('CAD Technician', true, 4),
  ('National service engineer', true, 5),
  ('Admin', false, 6);

-- Staff (brief §11) with approvers (D-015). Start dates default to the cost
-- history date; the Owner corrects them in the setup wizard (A-018).
with r as (select id, name from public.budget_roles)
insert into public.staff (full_name, job_title, budget_role_id, billable_default, is_national_service, start_date)
select v.full_name, v.job_title, r.id, v.billable, v.ns, date '2026-09-01'
from (values
  ('Kwasi Dadzie Ennison', 'Managing Director', 'Managing Director', true, false),
  ('Francis Austin', 'Senior Engineer', 'Senior Engineer', true, false),
  ('Ibrahim Commedan', 'CAD Technician', 'CAD Technician', true, false),
  ('Ernest Gbadago', 'Graduate Engineer', 'Graduate Engineer', true, false),
  ('Nana Poku', 'Civil Engineer (national service, extended)', 'National service engineer', true, true),
  ('NSP1 - Technical', 'National service engineer', 'National service engineer', true, true),
  ('NSP2 - Technical', 'National service engineer', 'National service engineer', true, true),
  ('NSP3 - Admin', 'Admin (national service)', 'Admin', false, true)
) v(full_name, job_title, role_name, billable, ns)
join r on r.name = v.role_name;

update public.staff s set approver_staff_id = (select id from public.staff where full_name = 'Kwasi Dadzie Ennison')
 where s.full_name in ('Francis Austin', 'NSP3 - Admin');
update public.staff s set approver_staff_id = (select id from public.staff where full_name = 'Francis Austin')
 where s.full_name in ('Ibrahim Commedan', 'Ernest Gbadago', 'Nana Poku', 'NSP1 - Technical', 'NSP2 - Technical');

insert into public.staff_cost_history (staff_id, effective_from, monthly_cost, source, notes)
select s.id, date '2026-09-01', v.cost, 'seed', 'PROJECT_BRIEF §11'
from (values
  ('Kwasi Dadzie Ennison', 20340), ('Francis Austin', 7443), ('Ibrahim Commedan', 4065),
  ('Ernest Gbadago', 4065), ('Nana Poku', 1200), ('NSP1 - Technical', 1200),
  ('NSP2 - Technical', 1200), ('NSP3 - Admin', 1200)
) v(full_name, cost)
join public.staff s on s.full_name = v.full_name;

-- Job types (brief §7.3)
insert into public.job_types (name, sort_order) values
  ('Structural design of buildings', 1),
  ('Structural assessment of existing structures', 2),
  ('Construction supervision', 3),
  ('Employer''s Representative and tender review', 4),
  ('Design and build contracting', 5),
  ('Engineering reports and concept input for others'' bids', 6);

-- Leave types (brief §7.3). Entitlements and document thresholds are set by
-- the Owner with the Accountant (statutory minimums).
insert into public.leave_types (name, is_paid, uses_annual_balance, requires_document, sort_order) values
  ('Annual', true, true, false, 1),
  ('Sick', true, false, true, 2),
  ('Maternity', true, false, true, 3),
  ('Paternity', true, false, false, 4),
  ('Compassionate/bereavement', true, false, false, 5),
  ('Study/exam', true, false, false, 6),
  ('Unpaid', false, false, false, 7),
  ('Other', true, false, false, 8);

-- Tax code names only; rates are entered and confirmed at setup (D-018).
insert into public.tax_codes (name, kind) values
  ('Standard', 'standard'), ('Zero-rated', 'zero_rated'), ('Exempt', 'exempt'), ('No VAT', 'no_vat');

-- Chart of expense categories (brief §7.1)
do $$
declare
  groups jsonb := $json$[
    ["Premises", false, ["Rent", "Service charge", "Utilities (electricity, water)", "Repairs and maintenance", "Security"]],
    ["Office running", false, ["Office supplies and stationery", "Printer ink and toner", "Printing and plotting",
      "Cleaning supplies", "Cleaning services", "Kitchen and refreshments", "Internet and phones", "Postage and courier"]],
    ["Software & IT", false, ["Software licences and subscriptions", "IT support and repairs", "Website and email hosting"]],
    ["Professional fees", false, ["Accounting and bookkeeping", "Audit", "Legal", "Consultants (non-job)", "Bank charges"]],
    ["Travel & transport (non-job)", false, ["Fuel", "Road tolls", "Taxi and ride-hailing", "Vehicle servicing and repairs", "Parking"]],
    ["Staff & welfare", false, ["Directors' fees and allowances", "Staff welfare (funerals, weddings, hospital visits)",
      "Team building and end-of-year events", "Training and CPD", "Medical", "Staff refreshments", "Uniforms and PPE"]],
    ["Compliance & memberships", false, ["Professional memberships", "Company annual returns", "Permits and licences", "Insurance"]],
    ["Business development", false, ["Marketing", "Company profiles", "Networking events", "Gifts"]],
    ["Job direct costs", true, ["Sublet work", "Equipment hire", "Vehicle hire", "Fuel and road tolls on job trips",
      "Travel and accommodation", "Per diems", "Testing and lab fees", "Printing of job drawings and reports",
      "Materials", "Site labour (casual wages)", "Plant", "Site consumables", "Other job costs"]]
  ]$json$;
  g jsonb;
  parent uuid;
  i int := 0;
  j int;
begin
  for g in select * from jsonb_array_elements(groups) loop
    i := i + 1;
    insert into public.expense_categories (name, requires_job, sort_order)
    values (g ->> 0, (g ->> 1)::boolean, i) returning id into parent;
    j := 0;
    insert into public.expense_categories (parent_id, name, requires_job, sort_order)
    select parent, c.value, (g ->> 1)::boolean, c.ordinality
    from jsonb_array_elements_text(g -> 2) with ordinality c;
  end loop;
end $$;
