-- site_emily: WordPress-like search relevance (title match, then excerpt match, then date).
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
    select p.id, p.date,
      case when p_search is null or p_search = '' then 0
           when p.title ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' then 2
           when p.excerpt ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%' then 1
           else 0 end as rel
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
  order by f.rel desc, f.date desc nulls last, f.id desc
  limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

