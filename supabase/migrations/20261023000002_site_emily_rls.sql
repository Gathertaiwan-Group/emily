-- site_emily: row level security.
-- anon/authenticated may only read published public content. All writes go through the server
-- (service_role bypasses RLS) after verifying the caller is in site_emily.admins.
-- Signed-in admins (site_emily.is_admin()) may read everything for the admin UI.

do $$
declare t text;
begin
  foreach t in array array['admins','audit_log','settings','authors','media','media_url_map','terms','posts','post_passwords','post_terms',
    'comments','comment_private','menus','menu_items','products','product_terms','product_attributes',
    'product_attribute_values','product_variations','quantity_discount_rules','customers','coupons','carts',
    'cart_items','orders','order_items','order_notes','forms','form_submissions','redirects']
  loop
    execute format('alter table site_emily.%I enable row level security', t);
    execute format('drop policy if exists admin_read on site_emily.%I', t);
    execute format('create policy admin_read on site_emily.%I for select to authenticated using (site_emily.is_admin())', t);
  end loop;
end $$;

-- public read policies ---------------------------------------------------------
drop policy if exists public_read on site_emily.settings;
create policy public_read on site_emily.settings for select to anon, authenticated using (is_public);

drop policy if exists public_read on site_emily.authors;
create policy public_read on site_emily.authors for select to anon, authenticated using (true);

drop policy if exists public_read on site_emily.media;
create policy public_read on site_emily.media for select to anon, authenticated using (true);

drop policy if exists public_read on site_emily.media_url_map;
create policy public_read on site_emily.media_url_map for select to anon, authenticated using (true);

drop policy if exists public_read on site_emily.terms;
create policy public_read on site_emily.terms for select to anon, authenticated using (true);

drop policy if exists public_read on site_emily.posts;
create policy public_read on site_emily.posts for select to anon, authenticated
  using (status = 'publish' and not exists (select 1 from site_emily.post_passwords pp where pp.post_id = id));

drop policy if exists public_read on site_emily.post_terms;
create policy public_read on site_emily.post_terms for select to anon, authenticated
  using (exists (select 1 from site_emily.posts p where p.id = post_id and p.status = 'publish'));

drop policy if exists public_read on site_emily.comments;
create policy public_read on site_emily.comments for select to anon, authenticated using (status = 'approved');

drop policy if exists public_read on site_emily.menus;
create policy public_read on site_emily.menus for select to anon, authenticated using (true);

drop policy if exists public_read on site_emily.menu_items;
create policy public_read on site_emily.menu_items for select to anon, authenticated using (true);

drop policy if exists public_read on site_emily.products;
create policy public_read on site_emily.products for select to anon, authenticated
  using (status = 'publish' and catalog_visibility <> 'hidden');

drop policy if exists public_read on site_emily.product_terms;
create policy public_read on site_emily.product_terms for select to anon, authenticated
  using (exists (select 1 from site_emily.products p where p.id = product_id and p.status = 'publish'));

drop policy if exists public_read on site_emily.product_attributes;
create policy public_read on site_emily.product_attributes for select to anon, authenticated using (true);

drop policy if exists public_read on site_emily.product_attribute_values;
create policy public_read on site_emily.product_attribute_values for select to anon, authenticated
  using (visible and exists (select 1 from site_emily.products p where p.id = product_id and p.status = 'publish'));

drop policy if exists public_read on site_emily.product_variations;
create policy public_read on site_emily.product_variations for select to anon, authenticated
  using (status = 'publish' and exists (select 1 from site_emily.products p where p.id = product_id and p.status = 'publish'));

drop policy if exists public_read on site_emily.quantity_discount_rules;
create policy public_read on site_emily.quantity_discount_rules for select to anon, authenticated
  using (enabled and (date_to is null or date_to > now()));

drop policy if exists public_read on site_emily.forms;
create policy public_read on site_emily.forms for select to anon, authenticated using (status = 'publish');

drop policy if exists public_read on site_emily.redirects;
create policy public_read on site_emily.redirects for select to anon, authenticated using (true);

-- private tables (no anon policy): admins, audit_log, comment_private, post_passwords, customers, coupons, carts, cart_items,
-- orders, order_items, order_notes, form_submissions.

grant usage on schema site_emily to anon, authenticated, service_role;
grant select on all tables in schema site_emily to anon, authenticated;

grant all on all tables in schema site_emily to service_role;
grant all on all sequences in schema site_emily to service_role;
grant execute on function site_emily.is_admin() to anon, authenticated, service_role;
