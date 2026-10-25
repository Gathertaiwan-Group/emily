-- site_emily: private data import (customers, orders, comments' private fields, form submissions).
-- Personal data is readable ONLY by the server (service_role: /admin + MCP). anon and authenticated —
-- including signed-in admins via PostgREST — get neither a policy nor a table grant.
do $$
declare t text;
begin
  foreach t in array array['customers','orders','order_items','order_notes','comment_private','form_submissions','carts','cart_items','coupons']
  loop
    execute format('alter table site_emily.%I enable row level security', t);
    execute format('drop policy if exists admin_read on site_emily.%I', t);
    execute format('drop policy if exists public_read on site_emily.%I', t);
    execute format('revoke all on site_emily.%I from anon, authenticated', t);
    execute format('grant all on site_emily.%I to service_role', t);
  end loop;
end $$;

-- Menus now come from WordPress nav_menu terms; the theme renders them by location.
create index if not exists menus_location_idx on site_emily.menus (location);

-- Attachment rows recovered from the private DB dump (parent post is a draft).
create index if not exists media_metadata_source_idx on site_emily.media (metadata_source);
