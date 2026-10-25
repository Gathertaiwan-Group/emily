import { srcSetOf, urlAtLeast } from "@/lib/img";
import { NextResponse } from "next/server";
import { getAllProducts, getQtyRules, isOnSale, rulesForProduct, variationForm } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Public product data for quick view / wishlist / compare. ?ids=1,2 or ?id=1 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const ids = (u.searchParams.get("ids") ?? u.searchParams.get("id") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 50);
  const [all, rules] = await Promise.all([getAllProducts(), getQtyRules()]);
  const list = all.filter((p) => ids.includes(p.id) && p.catalog_visibility !== "hidden");
  const out = await Promise.all(
    list.map(async (p) => {
      const vf = p.type === "variable" ? await variationForm(p.id) : { fields: [], variations: [] };
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        link: p.link_path,
        type: p.type,
        price: p.price,
        regular_price: p.regular_price,
        sale_price: p.sale_price,
        on_sale: isOnSale(p),
        stock_status: p.stock_status,
        manage_stock: p.manage_stock,
        stock_quantity: p.stock_quantity,
        sku: p.sku,
        short_description: p.short_description,
        image: p.image ? { url: p.image.public_url, thumb: urlAtLeast(p.image, 480), srcset: srcSetOf(p.image) ?? null, w: p.image.width, h: p.image.height, alt: p.image.alt_text } : null,
        gallery: p.gallery.map((m) => ({ url: m.public_url, thumb: urlAtLeast(m, 480), srcset: srcSetOf(m) ?? null, w: m.width, h: m.height, alt: m.alt_text })),
        cats: p.cats.map((c) => ({ name: c.name, link: c.link_path })),
        tags: p.tags.map((c) => ({ name: c.name, link: c.link_path })),
        sold_individually: p.sold_individually,
        max_qty: p.max_purchase_qty,
        purchasable: p.purchasable,
        qty_rules: rulesForProduct(rules, p).map((r) => ({ min: r.min_qty, max: r.max_qty, type: r.discount_type, amount: r.amount })),
        variations: vf.variations,
        fields: vf.fields,
      };
    }),
  );
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
