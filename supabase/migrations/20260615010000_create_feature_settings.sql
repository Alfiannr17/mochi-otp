create table if not exists public.feature_settings (
  feature_key text primary key,
  is_active boolean not null default true,
  maintenance_message text not null default '',
  updated_at timestamptz not null default now(),
  constraint feature_settings_key_check
    check (feature_key in ('server1', 'server2', 'deposit'))
);

insert into public.feature_settings (feature_key, is_active, maintenance_message)
values
  ('server1', true, 'Server 1 sedang maintenance. Silakan gunakan server lain atau coba lagi nanti.'),
  ('server2', true, 'Server 2 sedang maintenance. Silakan gunakan server lain atau coba lagi nanti.'),
  ('deposit', true, 'Fitur deposit sedang maintenance. Silakan coba lagi nanti.')
on conflict (feature_key) do nothing;

alter table public.feature_settings enable row level security;

