-- site_emily: helpers used by the Next.js storefront (archives, search) + small data fixes found while
-- rebuilding the frontend. Everything is scoped to schema site_emily.

-- Paginated archive/search listing. Returns the page of post ids (newest first) plus the total count.
create or replace function site_emily.list_post_ids(
  p_types    text[]   default array['post'],
  p_term_ids bigint[] default null,
  p_author   bigint   default null,
  p_search   text     default null,
  p_year     int      default null,
  p_month    int      default null,
  p_day      int      default null,
  p_limit    int      default 10,
  p_offset   int      default 0
)
returns table (id bigint, total bigint)
language sql
stable
set search_path = site_emily, pg_temp
as $$
  with f as (
    select p.id, p.date
    from site_emily.posts p
    where p.status = 'publish'
      and p.post_type = any (p_types)
      and not exists (select 1 from site_emily.post_passwords pp where pp.post_id = p.id)
      and (p_term_ids is null or exists (
            select 1 from site_emily.post_terms pt where pt.post_id = p.id and pt.term_id = any (p_term_ids)))
      and (p_author is null or p.author_id = p_author)
      and (p_search is null or p_search = '' or
           p.title ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' or
           p.excerpt ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' or
           p.content ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_year  is null or extract(year  from (p.date at time zone 'Asia/Taipei')) = p_year)
      and (p_month is null or extract(month from (p.date at time zone 'Asia/Taipei')) = p_month)
      and (p_day   is null or extract(day   from (p.date at time zone 'Asia/Taipei')) = p_day)
  )
  select f.id, count(*) over () as total
  from f
  order by f.date desc nulls last, f.id desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function site_emily.list_post_ids(text[], bigint[], bigint, text, int, int, int, int, int)
  to anon, authenticated, service_role;

create index if not exists posts_type_status_date_idx on site_emily.posts (post_type, status, date desc);
create index if not exists post_terms_term_idx on site_emily.post_terms (term_id, post_id);

-- The old shop listed only "小額贊助" while /?s=test found product "test": WooCommerce catalog
-- visibility of product 7651 is "search" (shown in search results, hidden from the shop loop).
update site_emily.products set catalog_visibility = 'search' where id = 7651 and catalog_visibility = 'visible';

-- Storefront forms that exist on the new site but had no definition row yet.
insert into site_emily.forms (slug, title, kind, source, action, method, fields, pages) values
  ('checkout', '結帳', 'checkout', 'woocommerce', '/checkout', 'post',
   '[{"name":"billing_last_name","type":"text","required":true},{"name":"billing_first_name","type":"text","required":true},
     {"name":"billing_company","type":"text","required":false},{"name":"billing_country","type":"select","required":true},
     {"name":"billing_postcode","type":"text","required":false},{"name":"billing_state","type":"text","required":false},
     {"name":"billing_city","type":"text","required":true},{"name":"billing_address_1","type":"text","required":true},
     {"name":"billing_address_2","type":"text","required":false},{"name":"billing_phone","type":"tel","required":true},
     {"name":"billing_email","type":"email","required":true},{"name":"order_comments","type":"textarea","required":false},
     {"name":"payment_method","type":"radio","required":true}]'::jsonb, '{/checkout,/checkout-2}'),
  ('register', '會員註冊', 'register', 'woocommerce', '/my-account', 'post',
   '[{"name":"email","type":"email","required":true},{"name":"password","type":"password","required":true}]'::jsonb, '{/my-account,/my-account-2}'),
  ('lost-password', '忘記密碼', 'lost_password', 'woocommerce', '/my-account/lost-password', 'post',
   '[{"name":"user_login","type":"text","required":true}]'::jsonb, '{/my-account/lost-password}')
on conflict (slug) do nothing;

-- Category display order observed on the old site's Categories widget (WP term_order).
update site_emily.terms t set menu_order = o.ord
from (select unnest(array[249,143,163,187,248,250,1,112,113,115,116,117,119,128,130,144,145,146,147,148,152,176,179,149,150,151]::bigint[]) as id,
             generate_series(1, 26) as ord) o
where t.id = o.id and t.taxonomy = 'category';

-- Distinct published posts per category including descendant categories (WP pad_counts).
create or replace function site_emily.category_padded_counts()
returns table (term_id bigint, padded bigint)
language sql stable set search_path = site_emily, pg_temp
as $$
  with recursive tree as (
    select id as root, id from site_emily.terms where taxonomy = 'category'
    union all
    select tree.root, c.id from tree join site_emily.terms c on c.parent_id = tree.id and c.taxonomy = 'category'
  )
  select tree.root, count(distinct pt.post_id)
  from tree
  join site_emily.post_terms pt on pt.term_id = tree.id
  join site_emily.posts p on p.id = pt.post_id and p.status = 'publish' and p.post_type = 'post'
  group by tree.root;
$$;
grant execute on function site_emily.category_padded_counts() to anon, authenticated, service_role;
