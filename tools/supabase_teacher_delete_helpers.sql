create or replace function public.teacher_delete_curriculum_node(
  node_level text,
  node_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('teacher', 'admin')
  ) then
    raise exception 'Teacher access required';
  end if;

  if node_level = 'area' then
    delete from public.curriculum_areas where id = node_id;
    get diagnostics deleted_count = row_count;
  elsif node_level = 'subtopic' then
    delete from public.curriculum_subtopics where id = node_id;
    get diagnostics deleted_count = row_count;
  elsif node_level = 'unit' then
    delete from public.curriculum_units where id = node_id;
    get diagnostics deleted_count = row_count;
  elsif node_level = 'phrase' then
    delete from public.curriculum_phrases where id = node_id;
    get diagnostics deleted_count = row_count;
  else
    raise exception 'Unknown curriculum node level: %', node_level;
  end if;

  return deleted_count;
end;
$$;

grant execute on function public.teacher_delete_curriculum_node(text, uuid) to authenticated;
