-- site_emily: admin back office + MCP support.
-- Media uploaded from /admin or MCP are tagged metadata_source = 'upload'.
alter table site_emily.media drop constraint if exists media_metadata_source_check;
alter table site_emily.media add constraint media_metadata_source_check
  check (metadata_source in ('rest','html_scan','db','upload'));
create index if not exists media_sha1_idx on site_emily.media (sha1);
create index if not exists audit_log_source_idx on site_emily.audit_log (source, at desc);
create index if not exists posts_status_date_idx on site_emily.posts (status, date) where status = 'future';
