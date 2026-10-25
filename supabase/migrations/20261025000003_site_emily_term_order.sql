-- Category ordering parity with loveccdd.com.
-- 1) meta.term_order = WordPress wp_terms.term_order (Category Order plugin). get_the_category()
--    sorts by term_order, then term_id; used for post cards, single-post meta and home blocks.
update site_emily.terms t
   set meta = t.meta || jsonb_build_object('term_order', v.o), updated_at = now()
  from (values (1,1),(112,2),(113,3),(115,4),(116,5),(117,6),(119,7),(128,8),(130,9)) as v(id,o)
 where t.id = v.id and t.taxonomy = 'category';

-- 2) menu_order = position in the live sidebar "Categories" widget (wp_list_categories). The old
--    site's ties among term_order-0 siblings came out in MySQL row order; this freezes the order
--    loveccdd.com serves today (成長日記, 自癒, 療癒系食譜, 啟程, 全部文章, 日常瑣事 …).
update site_emily.terms t
   set menu_order = v.o, updated_at = now()
  from (values (249,1),(143,2),(187,3),(248,4),(250,5),(163,6),(1,7),(112,8),(113,9),(115,10),(116,11),
               (117,12),(119,13),(128,14),(130,15),(144,16),(145,17),(146,18),(147,19),(148,20),
               (179,21),(149,22),(150,23),(151,24),(152,25),(176,26)) as v(id,o)
 where t.id = v.id and t.taxonomy = 'category';
