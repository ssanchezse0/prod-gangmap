create table if not exists public.zone_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('territories', 'legal', 'neighborhoods', 'heists', 'restaurants')),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.zone_admins enable row level security;
alter table public.zones enable row level security;

grant select on public.zones to anon, authenticated;
grant insert, update, delete on public.zones to authenticated;
grant select on public.zone_admins to authenticated;

create or replace function public.is_zone_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.zone_admins where user_id = auth.uid()
  );
$$;

revoke all on function public.is_zone_admin() from public;
grant execute on function public.is_zone_admin() to authenticated;

create policy "Admins can read their own admin record"
on public.zone_admins for select to authenticated
using (user_id = auth.uid());

create policy "Anyone can read zones"
on public.zones for select to anon, authenticated
using (true);

create policy "Admins can insert zones"
on public.zones for insert to authenticated
with check (public.is_zone_admin());

create policy "Admins can update zones"
on public.zones for update to authenticated
using (public.is_zone_admin())
with check (public.is_zone_admin());

create policy "Admins can delete zones"
on public.zones for delete to authenticated
using (public.is_zone_admin());