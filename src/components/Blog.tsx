import { getCategoryTree, getRecentPosts, type PostCard, type Term } from "@/lib/data";
import { isoLocal, stripTags, ymd } from "@/lib/format";
import { SOCIAL } from "@/lib/site";
import { href, SideItem } from "./Shell";

type CatNode = Awaited<ReturnType<typeof getCategoryTree>>[number];

function CatList({ nodes }: { nodes: CatNode[] }) {
  return (
    <>
      {nodes.map((n) => (
        <li key={n.term.id} className={`cat-item cat-item-${n.term.id}`}>
          <a href={href(n.term.link_path ?? "")}>
            {n.term.name} <span className="category-item-count">({n.term.count})</span>
          </a>
          {n.children.length > 0 && (
            <ul className="children">
              <CatList nodes={n.children} />
            </ul>
          )}
        </li>
      ))}
    </>
  );
}

export function FollowUs({ id = "penci_social_widget-5", cls = "pc_alignleft show-text", fs = 13 }: { id?: string; cls?: string; fs?: number }) {
  return (
    <aside id={id} className="widget penci_social_widget">
      <h3 className="widget-title penci-border-arrow">
        <span className="inner-arrow">Follow Us</span>
      </h3>
      <div className={`widget-social ${cls}`}>
        <a href={SOCIAL.facebook} aria-label="Facebook" rel="noreferrer" target="_blank">
          <i className="penci-faicon fa fa-facebook" style={{ fontSize: 14 }}></i> <span style={{ fontSize: fs }}>Facebook</span>
        </a>
        <a href={SOCIAL.instagram} aria-label="Instagram" rel="noreferrer" target="_blank">
          <i className="penci-faicon fa fa-instagram" style={{ fontSize: 14 }}></i> <span style={{ fontSize: fs }}>Instagram</span>
        </a>
      </div>
    </aside>
  );
}

export async function Sidebar({ categories = true }: { categories?: boolean }) {
  const [recent, tree] = await Promise.all([getRecentPosts(), getCategoryTree()]);
  return (
    <div id="sidebar" className="penci-sidebar-right penci-sidebar-content style-4 pcalign-center pciconp-right pcicon-right penci-sticky-sidebar">
      <div className="theiaStickySidebar">
        <FollowUs />
        <aside id="penci_latest_news_widget-5" className="widget penci_latest_news_widget">
          <h3 className="widget-title penci-border-arrow">
            <span className="inner-arrow">Recent Posts</span>
          </h3>
          <ul id="penci-latestwg-7030" className="side-newsfeed">
            {recent.map((p) => (
              <SideItem key={p.id} p={p} />
            ))}
          </ul>
        </aside>
        {categories && (
          <aside id="categories-4" className="widget widget_categories">
            <h3 className="widget-title penci-border-arrow">
              <span className="inner-arrow">Categories</span>
            </h3>
            <ul>
              <CatList nodes={tree} />
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}

export function CatLinks({ cats }: { cats: Term[] }) {
  return (
    <span className="cat">
      {cats.map((c) => (
        <a key={c.id} className={`penci-cat-name penci-cat-${c.id}`} href={href(c.link_path ?? "")} rel="category tag">
          {c.name}
        </a>
      ))}
    </span>
  );
}

function excerptText(p: PostCard) {
  const t = stripTags(p.excerpt);
  return t;
}

export function MasonryItem({ p }: { p: PostCard }) {
  const url = href(p.link_path);
  const m = p.media;
  const ratio = m && m.width && m.height ? (m.height / m.width) * 100 : null;
  const authorUrl = p.author?.link_path ? href(p.author.link_path) : "#";
  return (
    <article id={`post-${p.id}`} className="item item-masonry grid-masonry grid-masonry-2 hentry">
      {m && (
        <div className="thumbnail">
          <a href={url} className="post-thumbnail">
            <span className="penci-isotope-padding" style={{ paddingBottom: `${ratio ?? 66.6}%` }}></span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              width={585}
              height={ratio ? Math.round((585 * ratio) / 100) : 390}
              src={m.public_url}
              className="attachment-penci-masonry-thumb size-penci-masonry-thumb wp-post-image"
              alt={m.alt_text || ""}
              decoding="async"
              loading="lazy"
            />
          </a>
        </div>
      )}
      <div className="grid-header-box">
        <CatLinks cats={p.categories} />
        <h2 className="penci-entry-title entry-title grid-title">
          <a href={url}>{p.title}</a>
        </h2>
        <div className="penci-hide-tagupdated">
          <span className="author-italic author vcard">
            by{" "}
            <a className="url fn n" href={authorUrl}>
              {p.author?.name}
            </a>
          </span>
          <time className="entry-date published" dateTime={isoLocal(p.date)}>
            {ymd(p.date)}
          </time>
        </div>
        <div className="grid-post-box-meta">
          {p.post_type !== "page" && (
            <span className="otherl-date-author author-italic author vcard">
              by{" "}
              <a className="url fn n" href={authorUrl}>
                {p.author?.name}
              </a>
            </span>
          )}
          <span className="otherl-date">
            <time className="entry-date published" dateTime={isoLocal(p.date)}>
              {ymd(p.date)}
            </time>
          </span>
        </div>
      </div>
      {p.excerpt && (
        <div className="item-content entry-content">
          <p>{excerptText(p)}</p>
        </div>
      )}
    </article>
  );
}

export type ProductCardLite = { id: number; name: string; link_path: string; date: string };

export function ArchiveLayout({
  crumbs,
  titleLabel,
  title,
  items,
  extra,
  page,
  totalPages,
  base,
  query = "",
  intro,
  h1Class,
}: {
  crumbs: React.ReactNode;
  titleLabel: string;
  title: string;
  items: PostCard[];
  extra?: React.ReactNode;
  page: number;
  totalPages: number;
  base: string;
  query?: string;
  intro?: React.ReactNode;
  h1Class?: string;
}) {
  const pageUrl = (n: number) => `${base === "/" ? "" : href(base)}${n > 1 ? `/page/${n}` : base === "/" ? "/" : ""}${query}`;
  return (
    <>
      {crumbs}
      <div className="container penci_sidebar right-sidebar">
        <div id="main" className="penci-layout-masonry-2 penci-main-sticky-sidebar">
          <div className="theiaStickySidebar">
            <div className="archive-box">
              <div className="title-bar">
                <span>{titleLabel}</span> <h1 className={h1Class}>{title}</h1>
              </div>
            </div>
            {intro}
            {items.length === 0 && !extra ? (
              <div className="post-entry penci-empty-search">
                <p>Sorry, but nothing matched your search terms. Please try again with some different keywords.</p>
              </div>
            ) : (
              <div className="penci-wrap-masonry">
                <div className="penci-wrapper-data masonry penci-masonry">
                  {extra}
                  {items.map((p) => (
                    <MasonryItem key={p.id} p={p} />
                  ))}
                </div>
              </div>
            )}
            {totalPages > 1 && (
              <div className="penci-pagination">
                <div className="newer">
                  {page > 1 ? (
                    <a href={pageUrl(page - 1)}>
                      <span>
                        <i className="penci-faicon fa fa-angle-left"></i>Newer Posts
                      </span>
                    </a>
                  ) : (
                    <div className="disable-url">
                      <span>
                        <i className="penci-faicon fa fa-angle-left"></i>Newer Posts
                      </span>
                    </div>
                  )}
                </div>
                <div className="older">
                  {page < totalPages ? (
                    <a href={pageUrl(page + 1)}>
                      <span>
                        Older Posts <i className="penci-faicon fa fa-angle-right"></i>
                      </span>
                    </a>
                  ) : (
                    <div className="disable-url">
                      <span>
                        Older Posts <i className="penci-faicon fa fa-angle-right"></i>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <Sidebar />
      </div>
    </>
  );
}
