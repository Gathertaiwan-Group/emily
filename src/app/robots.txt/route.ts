import { SITE_URL } from "@/lib/site";

export function GET() {
  const body = `User-agent: *
Disallow: /wp-content/uploads/wc-logs/
Disallow: /wp-content/uploads/woocommerce_transient_files/
Disallow: /wp-content/uploads/woocommerce_uploads/
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap_index.xml
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=UTF-8" } });
}
