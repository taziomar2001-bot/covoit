-- CoVoit patch v4 — populate profile name + photo from Google sign-in metadata.
-- Paste into the Supabase SQL editor. Affects new users only. Safe to re-run.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, first_name, last_name, phone, photo_url)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'first_name',''),
                   new.raw_user_meta_data->>'given_name',
                   split_part(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name',''),' ',1),
                   ''),
          coalesce(nullif(new.raw_user_meta_data->>'last_name',''),
                   new.raw_user_meta_data->>'family_name',
                   ''),
          coalesce(new.raw_user_meta_data->>'phone',''),
          coalesce(new.raw_user_meta_data->>'picture', new.raw_user_meta_data->>'avatar_url'))
  on conflict (id) do nothing;
  return new;
end; $$;
