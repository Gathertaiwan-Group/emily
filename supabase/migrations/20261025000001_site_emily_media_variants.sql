-- Responsive WebP variants (widths 480/960/1440, never upscaled) stored at
-- site-emily/v/<width>/<storage_path>. One entry per generated width: {"w":480,"h":320,"path":"v/480/uploads/..."}
alter table site_emily.media add column if not exists variants jsonb not null default '[]'::jsonb;
