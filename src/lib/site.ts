// Public, non-secret site constants.
export const SITE_NAME = "The three of us";
// Canonical origin used for canonical/OG/sitemap URLs. Defaults to the production domain so the
// SEO tags stay identical to the old site; override with SITE_URL for previews.
export const SITE_URL = (process.env.SITE_URL || "https://loveccdd.com").replace(/\/$/, "");
export const SCHEMA = "site_emily";
export const TZ = "Asia/Taipei";
export const CURRENCY_SYMBOL = "NT$";
export const GTM_ID = "GTM-TG4K2VR";
export const GA4_ID = "G-D4TVJ4514B";
export const FB_PIXEL_ID = "2908067342800431";
export const FB_DOMAIN_VERIFICATION = "5sdocgg3bx09jnzqrncciku4qcmup0";
export const SLOGAN_LINES = [
  "Being deeply loved by someone gives you strength,",
  "while loving someone deeply gives you courage.",
];
export const STORAGE_BASE = "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/site-emily";
export const LOGO_URL = `${STORAGE_BASE}/uploads/2022/03/logo-4.webp`;
export const FAVICON_URL = `${STORAGE_BASE}/v/480/uploads/2022/03/1-4532e1ad.webp`; // 480px variant of the 871px icon
export const SOCIAL = {
  facebook: "https://www.facebook.com/ccddandme",
  instagram:
    "https://l.facebook.com/l.php?u=https%3A%2F%2Fwww.instagram.com%2Fccddandme%3Ffbclid%3DIwAR1R8QIMumv5r_i8SvJdZtD8qVLT4nPaBRyG-IyYcOXnBe_nfJs_0rSpa88&h=AT3uZgrFhGimhubaUxvrZqCUbSJW5sFkr5QBST4vaY6csZk6q0v_LYLcrRpdnmhWULrjOnqkXTdXCl-_vNRRrbXVbglZWpeNKQbhlGQ983H4f4X9ChRHjruZYC0bsPr1nna5JMgcKG1o_1YgI1Mo5CFBYA",
  email: "http://hehueiling@gmail.com",
  line: "#",
};
export const POSTS_PER_PAGE = 10;
export const PRODUCTS_PER_PAGE_DEFAULT = 24;
