-- CoVoit patch v3 — let a group's creator delete the group. Paste into Supabase SQL editor.
drop policy if exists groups_creator_delete on public.groups;
create policy groups_creator_delete on public.groups for delete using (created_by = auth.uid());
