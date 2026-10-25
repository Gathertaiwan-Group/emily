-- Footer tag cloud (block-22, core/tag-cloud -> wp_tag_cloud()).
-- loveccdd.com serves a different 45-tag set on almost every uncached request (verified: two live
-- requests 2026-10-25 returned two different sets; 933 saved pages carry >10 distinct sets), so the
-- WordPress "top 45 by count" query is not what visitors saw. Freeze the set the saved home page
-- shows; the front end falls back to wp_tag_cloud's default selection when this row is absent.
insert into site_emily.settings (key, value, is_public)
values ('tag_cloud', '{"term_ids": [317, 262, 177, 320, 299, 280, 321, 279, 120, 178, 141, 298, 263, 154, 301, 118, 175, 319, 153, 122, 209, 316, 206, 284, 261, 300, 121, 336, 174, 302, 207, 283, 334, 260, 259, 173, 210, 208, 123, 156, 277, 337, 333, 335, 155], "number": 45, "smallest": 8, "largest": 22, "unit": "pt", "source": "loveccdd.com home page snapshot"}'::jsonb, true)
on conflict (key) do update set value = excluded.value, is_public = true, updated_at = now();
