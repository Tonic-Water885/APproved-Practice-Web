create table if not exists public.curriculum_areas (
  id uuid primary key default gen_random_uuid(),
  title_en text not null,
  sort_index integer default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curriculum_subtopics (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.curriculum_areas(id) on delete cascade,
  title_en text not null,
  sort_index integer default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curriculum_units (
  id uuid primary key default gen_random_uuid(),
  subtopic_id uuid not null references public.curriculum_subtopics(id) on delete cascade,
  title_en text not null,
  sort_index integer default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.curriculum_phrases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.curriculum_units(id) on delete cascade,
  text_en text not null,
  text_fr text default '',
  text_it text default '',
  text_es text default '',
  sort_index integer default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.curriculum_areas enable row level security;
alter table public.curriculum_subtopics enable row level security;
alter table public.curriculum_units enable row level security;
alter table public.curriculum_phrases enable row level security;

drop policy if exists "teachers own curriculum areas" on public.curriculum_areas;
drop policy if exists "teachers own curriculum subtopics" on public.curriculum_subtopics;
drop policy if exists "teachers own curriculum units" on public.curriculum_units;
drop policy if exists "teachers own curriculum phrases" on public.curriculum_phrases;

drop policy if exists "teachers read all curriculum areas" on public.curriculum_areas;
drop policy if exists "teachers insert curriculum areas" on public.curriculum_areas;
drop policy if exists "teachers update all curriculum areas" on public.curriculum_areas;
drop policy if exists "teachers delete all curriculum areas" on public.curriculum_areas;

drop policy if exists "teachers read all curriculum subtopics" on public.curriculum_subtopics;
drop policy if exists "teachers insert curriculum subtopics" on public.curriculum_subtopics;
drop policy if exists "teachers update all curriculum subtopics" on public.curriculum_subtopics;
drop policy if exists "teachers delete all curriculum subtopics" on public.curriculum_subtopics;

drop policy if exists "teachers read all curriculum units" on public.curriculum_units;
drop policy if exists "teachers insert curriculum units" on public.curriculum_units;
drop policy if exists "teachers update all curriculum units" on public.curriculum_units;
drop policy if exists "teachers delete all curriculum units" on public.curriculum_units;

drop policy if exists "teachers read all curriculum phrases" on public.curriculum_phrases;
drop policy if exists "teachers insert curriculum phrases" on public.curriculum_phrases;
drop policy if exists "teachers update all curriculum phrases" on public.curriculum_phrases;
drop policy if exists "teachers delete all curriculum phrases" on public.curriculum_phrases;

create policy "teachers read all curriculum areas"
on public.curriculum_areas
for select
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers insert curriculum areas"
on public.curriculum_areas
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers update all curriculum areas"
on public.curriculum_areas
for update
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
)
with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers delete all curriculum areas"
on public.curriculum_areas
for delete
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers read all curriculum subtopics"
on public.curriculum_subtopics
for select
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers insert curriculum subtopics"
on public.curriculum_subtopics
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers update all curriculum subtopics"
on public.curriculum_subtopics
for update
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
)
with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers delete all curriculum subtopics"
on public.curriculum_subtopics
for delete
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers read all curriculum units"
on public.curriculum_units
for select
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers insert curriculum units"
on public.curriculum_units
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers update all curriculum units"
on public.curriculum_units
for update
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
)
with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers delete all curriculum units"
on public.curriculum_units
for delete
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers read all curriculum phrases"
on public.curriculum_phrases
for select
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers insert curriculum phrases"
on public.curriculum_phrases
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers update all curriculum phrases"
on public.curriculum_phrases
for update
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
)
with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

create policy "teachers delete all curriculum phrases"
on public.curriculum_phrases
for delete
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);

alter table public.curriculum_topics enable row level security;

drop policy if exists "teachers manage all curriculum topics" on public.curriculum_topics;

create policy "teachers manage all curriculum topics"
on public.curriculum_topics
for all
to authenticated
using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
)
with check (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('teacher', 'admin'))
);
