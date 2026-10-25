"use client";
/**
 * Re-implementation of the Soledad / WooCommerce front-end jQuery behaviours the old site relied on:
 * sticky header, mobile drawer, search toggle, go-to-top, side cart, product filter panel, masonry
 * grid, lazy backgrounds, ajax add-to-cart, wishlist/compare, quick view, PhotoSwipe lightbox,
 * Gutenslider (Swiper) and form-submission logging.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "photoswipe/style.css";
import { cartRequest, encPath, lists, logForm, money } from "./util";
import ProductForm from "./ProductForm";

type QV = {
  id: number;
  name: string;
  link: string;
  type: string;
  price: number | null;
  regular_price: number | null;
  sale_price: number | null;
  on_sale: boolean;
  short_description: string;
  image: { url: string; srcset?: string | null; w: number | null; h: number | null } | null;
  gallery: { url: string; srcset?: string | null; w: number | null; h: number | null }[];
  cats: { name: string; link: string | null }[];
  sold_individually: boolean;
  max_qty: number | null;
  stock_status: string;
  fields: { key: string; label: string; options: { value: string; label: string }[] }[];
  variations: any[];
};

function masonry() {
  document.querySelectorAll<HTMLElement>(".penci-masonry").forEach((wrap) => {
    const items = Array.from(wrap.children).filter((c) => c.classList.contains("item-masonry")) as HTMLElement[];
    if (!items.length) return;
    wrap.classList.remove("pc-masonry-ready");
    items.forEach((i) => ((i.style.position = ""), (i.style.left = ""), (i.style.top = "")));
    const W = wrap.clientWidth;
    const iw = items[0].getBoundingClientRect().width;
    const cs = getComputedStyle(items[0]);
    const outer = iw + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
    const cols = Math.max(1, Math.round(W / outer));
    if (cols <= 1) return;
    const colW = W / cols;
    const heights = new Array(cols).fill(0);
    const sizes = items.map((i) => i.getBoundingClientRect().height + parseFloat(getComputedStyle(i).marginBottom || "0"));
    wrap.classList.add("pc-masonry-ready");
    items.forEach((it, n) => {
      const c = heights.indexOf(Math.min(...heights));
      it.style.left = `${c * colW}px`;
      it.style.top = `${heights[c]}px`;
      heights[c] += sizes[n];
    });
    wrap.style.height = `${Math.max(...heights)}px`;
  });
}

function toast(text: string) {
  const el = document.createElement("div");
  el.className = "penci-notice";
  el.style.cssText = "position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:99999999;box-shadow:0 2px 10px rgba(0,0,0,.15);background:#fff";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

export default function SiteScripts() {
  const [qv, setQv] = useState<QV | null>(null);
  const [qvLoading, setQvLoading] = useState(false);

  useEffect(() => {
    const body = document.body;
    const cleanups: (() => void)[] = [];
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(t, f as any, opts);
      cleanups.push(() => window.removeEventListener(t, f as any));
    };

    // ---- sticky header + go-to-top
    const wrapper = document.getElementById("navigation-sticky-wrapper");
    const nav = document.getElementById("navigation");
    const top = document.querySelector<HTMLElement>(".penci-go-to-top-floating");
    const onScroll = () => {
      if (wrapper && nav) {
        const start = wrapper.getBoundingClientRect().top + window.scrollY;
        if (!wrapper.classList.contains("is-sticky")) wrapper.style.height = `${nav.offsetHeight}px`;
        const stick = window.scrollY > start;
        wrapper.classList.toggle("is-sticky", stick);
        nav.classList.toggle("sticky", stick);
      }
      top?.classList.toggle("show-up", window.scrollY > 300);
    };
    on("scroll", onScroll, { passive: true });
    onScroll();

    // ---- masonry + lazy backgrounds
    document.querySelectorAll<HTMLElement>("[data-bgset]").forEach((el) => {
      if (!el.style.backgroundImage) el.style.backgroundImage = `url('${el.dataset.bgset}')`;
    });
    masonry();
    document.querySelectorAll(".penci-masonry img").forEach((img) => img.addEventListener("load", masonry));
    let rt: ReturnType<typeof setTimeout>;
    on("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(masonry, 120);
    });
    on("load", masonry);

    // ---- Penci sticky sidebar (theia-sticky-sidebar replacement). The theme wrappers use
    // overflow:hidden, so CSS position:sticky cannot work; translate the inner wrapper instead.
    const sidebars = Array.from(document.querySelectorAll<HTMLElement>("#sidebar.penci-sticky-sidebar"));
    const stickySidebars = () => {
      for (const sb of sidebars) {
        const inner = sb.querySelector<HTMLElement>(":scope > .theiaStickySidebar");
        const main = sb.parentElement?.querySelector<HTMLElement>(":scope > #main, :scope > .bottom-content");
        if (!inner || !main) continue;
        if (window.innerWidth < 1024) {
          sb.style.minHeight = "";
          inner.style.transform = "";
          continue;
        }
        sb.style.minHeight = `${main.offsetHeight}px`;
        const top = sb.getBoundingClientRect().top + window.scrollY;
        const free = sb.offsetHeight - inner.offsetHeight;
        if (free <= 0) {
          inner.style.transform = "";
          continue;
        }
        const head = (nav?.offsetHeight ?? 60) + 20;
        const want = inner.offsetHeight + head + 20 <= window.innerHeight ? window.scrollY + head - top : window.scrollY + window.innerHeight - inner.offsetHeight - 20 - top;
        inner.style.transform = `translateY(${Math.round(Math.max(0, Math.min(free, want)))}px)`;
      }
    };
    if (sidebars.length) {
      stickySidebars();
      on("scroll", stickySidebars, { passive: true });
      on("load", stickySidebars);
      on("resize", stickySidebars);
      setTimeout(stickySidebars, 1500);
    }

    // ---- Elementor entrance animations (frontend.js replacement). Elementor renders animated
    // widgets with .elementor-invisible (visibility:hidden) and reveals them on scroll-in by adding
    // "animated <name>" from data-settings (_animation / _animation_tablet / _animation_mobile).
    const invisible = Array.from(document.querySelectorAll<HTMLElement>(".elementor-invisible"));
    if (invisible.length) {
      const reveal = (el: HTMLElement) => {
        let s: Record<string, any> = {};
        try {
          s = JSON.parse(el.dataset.settings || "{}");
        } catch {}
        const w = window.innerWidth;
        const pick = (k: string) => (w < 768 && s[`${k}_mobile`]) || (w < 1025 && s[`${k}_tablet`]) || s[k];
        const name = String(pick("_animation") || pick("animation") || "");
        const delay = Number(s._animation_delay ?? s.animation_delay ?? 0) || 0;
        const run = () => {
          el.classList.remove("elementor-invisible");
          if (name && name !== "none") el.classList.add("animated", name);
        };
        if (delay > 0) setTimeout(run, delay);
        else run();
      };
      if (!("IntersectionObserver" in window)) invisible.forEach(reveal);
      else {
        const io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              io.unobserve(e.target);
              reveal(e.target as HTMLElement);
            }
          },
        );
        invisible.forEach((el) => io.observe(el));
        cleanups.push(() => io.disconnect());
      }
    }

    // ---- related posts carousel (owl replacement: paged items + dots)
    document.querySelectorAll<HTMLElement>(".penci-related-carousel").forEach((car) => {
      if (car.dataset.ready) return;
      car.dataset.ready = "1";
      const items = Array.from(car.querySelectorAll<HTMLElement>(":scope > .item-related"));
      const dots = document.createElement("div");
      dots.className = "owl-dots";
      car.classList.add("owl-loaded");
      car.appendChild(dots);
      let page = 0;
      const perView = () => (window.innerWidth < 768 ? Number(car.dataset.tabsmall || 2) : window.innerWidth < 1024 ? Number(car.dataset.tablet || 2) : Number(car.dataset.item || 3));
      const render = () => {
        const n = perView();
        const pages = Math.max(1, Math.ceil(items.length / n));
        page = Math.min(page, pages - 1);
        items.forEach((it, i) => {
          it.style.display = i >= page * n && i < page * n + n ? "block" : "none";
          it.style.width = `${100 / n}%`;
          it.style.float = "left";
        });
        dots.innerHTML = "";
        dots.classList.toggle("disabled", pages < 2);
        for (let p = 0; p < pages; p++) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `owl-dot${p === page ? " active" : ""}`;
          b.setAttribute("aria-label", `Page ${p + 1}`);
          b.innerHTML = "<span></span>";
          b.addEventListener("click", () => ((page = p), render()));
          dots.appendChild(b);
        }
      };
      render();
      on("resize", render);
    });

    // ---- mobile drawer sub-menu toggles (Soledad appends <u class="indicator"> inside the link)
    document.querySelectorAll<HTMLElement>("#sidebar-nav .menu-item-has-children").forEach((li) => {
      const link = li.querySelector<HTMLAnchorElement>(":scope > a");
      const sub = li.querySelector<HTMLElement>(":scope > .sub-menu");
      if (!link || !sub || link.querySelector(".indicator")) return;
      const u = document.createElement("u");
      u.className = "indicator";
      u.innerHTML = '<i class="penci-faicon fa fa-angle-down"></i>';
      link.appendChild(u);
      sub.style.display = "none";
      u.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const open = sub.style.display === "none";
        sub.style.display = open ? "block" : "none";
        li.classList.toggle("toggled-on", open);
        u.querySelector("i")!.className = `penci-faicon fa fa-angle-${open ? "up" : "down"}`;
      });
    });

    // ---- delegated clicks
    const click = async (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const a = t.closest<HTMLElement>("a, .button-menu-mobile, .search-click, .penci-go-to-top-floating, .sidebar-cart-close, .sidebar-filter-close, .sidebar-filter-close-button, .penci-post-like");
      if (!a) return;
      if (a.matches(".button-menu-mobile")) return body.classList.add("open-sidebar-nav");
      if (a.id === "close-sidebar-nav") return e.preventDefault(), body.classList.remove("open-sidebar-nav");
      if (a.matches(".search-click")) {
        e.preventDefault();
        const box = document.querySelector<HTMLElement>("#top-search .show-search");
        if (box) {
          const show = getComputedStyle(box).display === "none";
          box.style.display = show ? "block" : "none";
          if (show) box.querySelector<HTMLInputElement>("input.search-input")?.focus();
        }
        return;
      }
      if (a.matches(".penci-go-to-top-floating")) return window.scrollTo({ top: 0, behavior: "smooth" });
      if (a.matches(".cart-contents")) {
        if (location.pathname === "/cart") return;
        e.preventDefault();
        return body.classList.add("open-sidecart");
      }
      if (a.matches(".sidebar-cart-close")) return body.classList.remove("open-sidecart");
      if (a.matches(".penci-filter-button")) return e.preventDefault(), body.classList.add("open-filter-side");
      if (a.matches(".sidebar-filter-close, .sidebar-filter-close-button")) return body.classList.remove("open-filter-side");
      if (a.matches(".penci-post-like")) {
        e.preventDefault();
        const liked = a.classList.toggle("liked");
        const cnt = a.parentElement?.querySelector(".count-number-like");
        if (cnt) cnt.textContent = String(Math.max(0, Number(cnt.textContent || 0) + (liked ? 1 : -1)));
        return;
      }
      if (a.matches(".ajax_add_to_cart")) {
        e.preventDefault();
        a.classList.add("loading");
        const r = await cartRequest({ action: "add", product_id: Number(a.dataset.product_id), quantity: Number(a.dataset.quantity || 1) });
        a.classList.remove("loading");
        if (r.error) toast(r.error);
        else {
          a.classList.add("added");
          body.classList.add("open-sidecart");
        }
        return;
      }
      if (a.matches(".penci-addtowishlist, .penci-compare")) {
        e.preventDefault();
        const kind = a.matches(".penci-addtowishlist") ? "wishlist" : "compare";
        const id = Number(a.dataset.pid);
        const added = lists.toggle(kind, id, true);
        a.classList.toggle("added", added);
        toast(kind === "wishlist" ? "已加入願望清單（Wishlist）" : "已加入比較清單（Compare）");
        return;
      }
      if (a.matches(".penci-quickview-button")) {
        e.preventDefault();
        setQvLoading(true);
        const res = await fetch(`/api/products?id=${a.dataset.pid}`);
        const [p] = (await res.json()) as QV[];
        setQvLoading(false);
        if (p) setQv(p);
        return;
      }
    };
    document.addEventListener("click", click);
    cleanups.push(() => document.removeEventListener("click", click));
    document.querySelectorAll(".penci-addtowishlist").forEach((el) => el.classList.toggle("added", lists.get("wishlist").includes(Number((el as HTMLElement).dataset.pid))));
    document.querySelectorAll(".penci-compare").forEach((el) => el.classList.toggle("added", lists.get("compare").includes(Number((el as HTMLElement).dataset.pid))));

    // ---- GET add-to-cart / add-to-wishlist / add-to-compare (WooCommerce URL API)
    const sp = new URLSearchParams(location.search);
    const strip = (k: string) => {
      sp.delete(k);
      history.replaceState(null, "", location.pathname + (sp.toString() ? `?${sp}` : ""));
    };
    if (sp.get("add-to-cart")) {
      const id = Number(sp.get("add-to-cart"));
      strip("add-to-cart");
      void cartRequest({ action: "add", product_id: id, quantity: Number(sp.get("quantity") || 1) }).then((r) => (r.error ? toast(r.error) : body.classList.add("open-sidecart")));
    }
    for (const k of ["wishlist", "compare"] as const) {
      const v = sp.get(`add-to-${k}`);
      if (v) {
        lists.toggle(k, Number(v), true);
        strip(`add-to-${k}`);
        toast(k === "wishlist" ? "已加入願望清單（Wishlist）" : "已加入比較清單（Compare）");
      }
    }

    // ---- form logging (GET forms navigate normally)
    const submit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      const kind = f.dataset.form;
      if (kind === "search") logForm("search", { s: (f.elements.namedItem("s") as HTMLInputElement)?.value ?? "" });
      if (kind === "product-price-filter") {
        const fd = new FormData(f);
        logForm("product-price-filter", { min_price: String(fd.get("min_price") ?? ""), max_price: String(fd.get("max_price") ?? "") });
      }
    };
    document.addEventListener("submit", submit);
    cleanups.push(() => document.removeEventListener("submit", submit));

    // ---- comment form prefill
    try {
      const c = JSON.parse(localStorage.getItem("emily_commenter") || "null");
      if (c) for (const k of ["author", "email", "url"]) {
        const el = document.querySelector<HTMLInputElement>(`#commentform [name="${k}"]`);
        if (el && !el.value) el.value = c[k] ?? "";
      }
    } catch {}

    // ---- PhotoSwipe lightbox (product gallery + post images)
    const lightboxes: { destroy: () => void }[] = [];
    (async () => {
      const { default: PhotoSwipeLightbox } = await import("photoswipe/lightbox");
      const pswp = () => import("photoswipe");
      const sized = (a: HTMLAnchorElement) => {
        const img = a.querySelector("img");
        if (!a.dataset.pswpWidth) {
          a.dataset.pswpWidth = String(Number(a.dataset.w) || img?.naturalWidth || 1600);
          a.dataset.pswpHeight = String(Number(a.dataset.h) || img?.naturalHeight || 1200);
        }
      };
      const gallery = document.querySelector<HTMLElement>("[data-pswp-gallery]");
      if (gallery) {
        const lb = new PhotoSwipeLightbox({ gallery, children: "a[data-pswp-item]", pswpModule: pswp, wheelToZoom: true });
        lb.init();
        lightboxes.push(lb);
        gallery.querySelector("[data-pswp-open]")?.addEventListener("click", (e) => {
          e.preventDefault();
          lb.loadAndOpen(0, { gallery, children: "a[data-pswp-item]" } as any);
        });
      }
      const post = document.querySelector<HTMLElement>(".penci-single-wrapper");
      if (post) {
        const links = Array.from(post.querySelectorAll<HTMLAnchorElement>(".post-image a[data-lightbox], .penci-enable-lightbox .inner-post-entry a"))
          .filter((a) => /\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(a.href) && a.querySelector("img"));
        links.forEach((a) => {
          a.dataset.pswpItem = "";
          sized(a);
        });
        if (links.length) {
          const lb = new PhotoSwipeLightbox({ dataSource: links.map((a) => ({ src: a.href, width: Number(a.dataset.pswpWidth), height: Number(a.dataset.pswpHeight), element: a })), pswpModule: pswp, wheelToZoom: true });
          lb.init();
          lightboxes.push(lb);
          links.forEach((a, i) =>
            a.addEventListener("click", (e) => {
              e.preventDefault();
              lb.loadAndOpen(i);
            }),
          );
        }
      }
    })();
    cleanups.push(() => lightboxes.forEach((l) => l.destroy()));

    // ---- Gutenslider (Swiper)
    const sliders = document.querySelectorAll<HTMLElement>(".wp-block-eedee-block-gutenslider .swiper");
    if (sliders.length) {
      (async () => {
        const [{ default: Swiper }, mods] = await Promise.all([import("swiper"), import("swiper/modules")]);
        await import("swiper/css" as string).catch(() => undefined);
        sliders.forEach((el) => {
          let settings: any = {};
          try {
            settings = JSON.parse(el.dataset.settings || "{}");
          } catch {}
          const outer = el.closest(".wp-block-eedee-block-gutenslider");
          new Swiper(el, {
            modules: [mods.Navigation, mods.Pagination, mods.Autoplay, mods.EffectFade],
            loop: settings.loop ?? true,
            speed: settings.speed ?? 500,
            effect: settings.effect === "fade" ? "fade" : "slide",
            autoHeight: outer?.classList.contains("adaptive-height") ?? false,
            autoplay: settings.autoplay ? { delay: settings.autoplay.delay ?? 3000, pauseOnMouseEnter: !!settings.autoplay.pauseOnMouseEnter } : false,
            navigation: { nextEl: outer?.querySelector<HTMLElement>(".eedee-swiper-button-next, .swiper-button-next") ?? undefined, prevEl: outer?.querySelector<HTMLElement>(".eedee-swiper-button-prev, .swiper-button-prev") ?? undefined },
            pagination: { el: outer?.querySelector<HTMLElement>(".swiper-pagination") ?? undefined, clickable: true },
          });
        });
      })();
    }

    return () => cleanups.forEach((f) => f());
  }, []);

  useEffect(() => {
    document.body.style.overflow = qv ? "hidden" : "";
  }, [qv]);

  if (!qv && !qvLoading) return null;
  return createPortal(
    <>
      <div className="mfp-bg mfp-ready" onClick={() => setQv(null)}></div>
      {qvLoading && !qv && (
        <div className="mfp-wrap mfp-ready" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
          Loading…
        </div>
      )}
      {qv && (
        <div className="mfp-wrap mfp-close-btn-in mfp-auto-cursor quick-view-wrapper woocommerce mfp-ready" tabIndex={-1} style={{ overflow: "hidden auto" }} onClick={(e) => e.target === e.currentTarget && setQv(null)}>
          <div className="mfp-container mfp-s-ready mfp-inline-holder" onClick={(e) => e.target === e.currentTarget && setQv(null)}>
            <div className="mfp-content">
              <div className="penci-content-quickview">
                <div id={`product-${qv.id}`} className={`show-variable product type-product post-${qv.id} status-publish ${qv.stock_status} product-type-${qv.type}`}>
                  <div className="woocommerce-product-gallery woocommerce-product-gallery--with-images woocommerce-product-gallery--columns-4 images thumbnail-bottom quickview-screen">
                    <div className="theiaStickySidebar">
                      {[qv.image, ...qv.gallery].filter(Boolean).slice(0, 1).map((m, i) => (
                        <figure key={i} className="woocommerce-product-gallery__wrapper">
                          <div className="woocommerce-product-gallery__image">
                            <a href={encPath(qv.link)}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img width={600} height={600} src={m!.url} srcSet={m!.srcset ?? undefined} sizes={m!.srcset ? "(max-width: 768px) 100vw, 600px" : undefined} decoding="async" className="wp-post-image" alt="" />
                            </a>
                          </div>
                        </figure>
                      ))}
                    </div>
                  </div>
                  <div className="entry-summary-wrapper penci-scroll">
                    <div className="summary entry-summary">
                      <h1 className="product_title entry-title">{qv.name}</h1>
                      <p className="price">
                        {qv.on_sale ? (
                          <>
                            <del>{money(Number(qv.regular_price))}</del> <ins>{money(Number(qv.sale_price))}</ins>
                          </>
                        ) : (
                          money(Number(qv.price ?? qv.regular_price ?? 0))
                        )}
                      </p>
                      <div className="woocommerce-product-details__short-description" dangerouslySetInnerHTML={{ __html: qv.short_description }} />
                      {qv.stock_status !== "outofstock" ? (
                        <ProductForm
                          compact
                          product={{ id: qv.id, name: qv.name, link: qv.link, type: qv.type, soldIndividually: qv.sold_individually, maxQty: qv.max_qty }}
                          variationForm={qv.type === "variable" ? { fields: qv.fields, variations: qv.variations } : null}
                          onAdded={() => setQv(null)}
                        />
                      ) : (
                        <p className="stock out-of-stock">缺貨</p>
                      )}
                      <div className="penci-extra-buttons">
                        <a title="Add to Wishlist" href={`?add-to-wishlist=${qv.id}`} data-pid={qv.id} className="penci-addtowishlist button ">
                          Add to Wishlist
                        </a>
                        <a data-method="add" href={`?add-to-compare=${qv.id}`} className="button compare penci-compare" data-pid={qv.id}>
                          Add to Compare
                        </a>
                      </div>
                      <div className="product_meta">
                        {qv.cats.length > 0 && (
                          <span className="posted_in">
                            <span className="product_meta_title">分類:</span>{" "}
                            {qv.cats.map((c) => (
                              <a key={c.name} href={encPath(c.link ?? "")} rel="tag">
                                {c.name}
                              </a>
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <button title="Close (Esc)" type="button" className="mfp-close" onClick={() => setQv(null)}>
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
