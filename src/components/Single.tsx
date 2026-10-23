import { adjacentPosts, approvedComments, getAuthors, mediaByIds, postTerms, relatedPosts, type Post } from "@/lib/data";
import { transformContent } from "@/lib/content";
import { isoLocal, trimChars, ymd } from "@/lib/format";
import { SITE_URL } from "@/lib/site";
import { CatLinks, Sidebar } from "./Blog";
import { Crumbs, href, ShareLinks } from "./Shell";
import CommentForm from "./client/CommentForm";

export async function SinglePost({ post }: { post: Post }) {
  const [terms, authors, media, comments] = await Promise.all([
    postTerms(post.id),
    getAuthors(),
    mediaByIds([post.featured_media_id]),
    approvedComments(post.id),
  ]);
  const cats = terms.filter((t) => t.taxonomy === "category");
  const tags = terms.filter((t) => t.taxonomy === "post_tag");
  const author = post.author_id ? authors.get(post.author_id) : undefined;
  const img = post.featured_media_id ? media.get(post.featured_media_id) : undefined;
  const [{ prev, next }, related] = await Promise.all([adjacentPosts(post), relatedPosts(post, cats)]);
  const url = href(post.link_path);
  const abs = SITE_URL + url;
  const authorUrl = author?.link_path ? href(author.link_path) : "#";
  const ccount = `${comments.length} comment${comments.length === 1 ? "" : "s"}`.replace("0 comments", "0 comment");
  return (
    <div className="penci-single-wrapper">
      <div className="penci-single-block">
        <Crumbs cls="container penci-breadcrumb single-breadcrumb" items={[...(cats[0] ? [{ label: cats[0].name, url: cats[0].link_path ?? "" }] : []), { label: post.title }]} />
        <div className="penci-single-pheader container container-single container-single-fullwidth hentry">
          <div className="header-standard header-classic single-header">
            <div className="penci-standard-cat penci-single-cat">
              <CatLinks cats={cats} />
            </div>
            <h1 className="post-title single-post-title entry-title">{post.title}</h1>
            <div className="penci-hide-tagupdated">
              <span className="author-italic author vcard">
                by{" "}
                <a className="url fn n" href={authorUrl}>
                  {author?.name}
                </a>
              </span>
              <time className="entry-date published" dateTime={isoLocal(post.date)}>
                {ymd(post.date)}
              </time>
            </div>
            <div className="post-box-meta-single">
              <span className="author-post byline">
                <span className="author vcard">
                  by{" "}
                  <a className="author-url url fn n" href={authorUrl}>
                    {author?.name}
                  </a>
                </span>
              </span>
              <span>
                <time className="entry-date published" dateTime={isoLocal(post.date)}>
                  {ymd(post.date)}
                </time>
              </span>
              <span>{ccount}</span>
            </div>
          </div>
          {img && (
            <div className="post-image">
              <a href={img.public_url} data-rel="penci-gallery-image-content" data-lightbox data-w={img.width ?? undefined} data-h={img.height ?? undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="attachment-penci-full-thumb size-penci-full-thumb wp-post-image pc-singlep-img"
                  width={img.width ?? undefined}
                  height={img.height ?? undefined}
                  src={img.public_url}
                  alt={img.alt_text || ""}
                  title={img.title}
                />
              </a>
            </div>
          )}
        </div>
        <div className="container container-single penci_sidebar penci-enable-lightbox">
          <div id="main" className="penci-main-sticky-sidebar">
            <div className="theiaStickySidebar">
              <article id={`post-${post.id}`} className="post type-post status-publish">
                <div className="post-entry blockquote-style-1">
                  <div className="inner-post-entry entry-content" id="penci-post-entry-inner" dangerouslySetInnerHTML={{ __html: transformContent(post.content) }} />
                  <div className="penci-single-link-pages"></div>
                  {tags.length > 0 && (
                    <div className="post-tags">
                      {tags.map((t) => (
                        <a key={t.id} href={href(t.link_path ?? "")} rel="tag">
                          {t.name}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="tags-share-box single-post-share tags-share-box-s1 center-box social-align-default">
                  <span className="single-comment-o">
                    <i className="penci-faicon fa fa-comment-o"></i>
                    {ccount}
                  </span>
                  <div className="post-share">
                    <span className="post-share-item post-share-plike">
                      <span className="count-number-like">0</span>
                      <a href="#" aria-label="Like this post" className="penci-post-like single-like-button" data-post_id={post.id} title="Like" data-like="Like" data-unlike="Unlike">
                        <i className="penci-faicon fa fa-heart-o"></i>
                      </a>
                    </span>
                    <ShareLinks url={abs} title={post.title} wrap={false} />
                  </div>
                </div>
                <div className="post-author abio-style-1 bioimg-round">
                  <div className="author-img">
                    {author?.avatar_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" src={author.avatar_url.replace("s=96", "s=100")} className="avatar avatar-100 photo" height={100} width={100} loading="lazy" decoding="async" />
                    )}
                  </div>
                  <div className="author-content">
                    <h5>
                      <a href={authorUrl} title={`Author ${author?.name ?? ""}`} rel="author">
                        {author?.name}
                      </a>
                    </h5>
                    <p>{author?.description}</p>
                    <div className="bio-social"></div>
                  </div>
                </div>
                <div className="post-pagination">
                  {prev && (
                    <div className="prev-post">
                      <div className="prev-post-inner">
                        <div className="prev-post-title">
                          <span>previous post</span>
                        </div>
                        <a href={href(prev.link_path)}>
                          <div className="pagi-text">
                            <h5 className="prev-title">{prev.title}</h5>
                          </div>
                        </a>
                      </div>
                    </div>
                  )}
                  {next && (
                    <div className="next-post">
                      <div className="next-post-inner">
                        <div className="prev-post-title next-post-title">
                          <span>next post</span>
                        </div>
                        <a href={href(next.link_path)}>
                          <div className="pagi-text">
                            <h5 className="next-title">{next.title}</h5>
                          </div>
                        </a>
                      </div>
                    </div>
                  )}
                </div>
                {related.length > 0 && (
                  <div className="post-related">
                    <div className="post-title-box">
                      <h4 className="post-box-title">You may also like</h4>
                    </div>
                    <div className="penci-owl-carousel penci-owl-carousel-slider penci-related-carousel pc-related-scroller" data-item="3" data-desktop="3" data-tablet="2" data-tabsmall="2">
                      {related.map((r) => (
                        <div key={r.id} className="item-related">
                          <a
                            className="related-thumb penci-image-holder"
                            style={r.media ? { backgroundImage: `url('${r.media.public_url}')` } : undefined}
                            href={href(r.link_path)}
                            title={r.title}
                          ></a>
                          <h3>
                            <a href={href(r.link_path)}>{trimChars(r.title, 12)}</a>
                          </h3>
                          <span className="date">
                            <time className="entry-date published" dateTime={isoLocal(r.date)}>
                              {ymd(r.date)}
                            </time>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className={`post-comments ${comments.length ? "" : "no-comment-yet "}penci-comments-hide-0`} id="comments">
                  {comments.length > 0 && (
                    <>
                      <div className="post-title-box">
                        <h4 className="post-box-title">{ccount}</h4>
                      </div>
                      <div className="comments">
                        {comments.map((c) => (
                          <div key={c.id} className="comment" id={`comment-${c.id}`}>
                            <div className="thecomment">
                              <div className="author-img">
                                {c.avatar_url && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img alt="" src={c.avatar_url} className="avatar avatar-100 photo" height={100} width={100} loading="lazy" />
                                )}
                              </div>
                              <div className="comment-text">
                                <span className="author">{c.author_url ? <a href={c.author_url}>{c.author_name}</a> : c.author_name}</span>
                                <span className="date">
                                  <i className="penci-faicon fa fa-clock-o"></i>
                                  {ymd(c.date)}
                                </span>
                                <div className="comment-content" dangerouslySetInnerHTML={{ __html: c.content }} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {post.comment_status === "open" && <CommentForm postId={post.id} />}
                </div>
              </article>
            </div>
          </div>
          <Sidebar />
        </div>
      </div>
    </div>
  );
}

export async function PageView({ post, home = false, children }: { post: Post; home?: boolean; children?: React.ReactNode }) {
  const full = post.template === "page-fullwidth.php";
  const html = children ? undefined : { __html: transformContent(post.content) };
  if (full) {
    return (
      <div className="container-single-page container-default-page">
        {html ? <div id="main" className="penci-main-single-page-default" dangerouslySetInnerHTML={html} /> : <div id="main" className="penci-main-single-page-default">{children}</div>}
      </div>
    );
  }
  const authors = await getAuthors();
  const author = post.author_id ? authors.get(post.author_id) : undefined;
  let parentCrumb: { label: string; url: string } | null = null;
  if (post.parent_id) {
    const { getPostById } = await import("@/lib/data");
    const parent = await getPostById(post.parent_id);
    if (parent) parentCrumb = { label: parent.title, url: parent.link_path };
  }
  const abs = SITE_URL + href(post.link_path);
  return (
    <>
      <Crumbs items={[...(parentCrumb ? [parentCrumb] : []), { label: post.title }]} />
      <div className="container container-single-page container-default-page penci_is_nosidebar">
        <div id="main" className="penci-main-single-page-default penci-main-sticky-sidebar">
          <div className="theiaStickySidebar">
            <article id={`post-${post.id}`} className={`post-${post.id} page type-page status-publish hentry`}>
              {!home && (
                <div className="penci-page-header">
                  <h1 className="entry-title">{post.title}</h1>
                </div>
              )}
              <div className="penci-hide-tagupdated">
                <span className="author-italic author vcard">
                  by{" "}
                  <a className="url fn n" href={author?.link_path ? href(author.link_path) : "#"}>
                    {author?.name}
                  </a>
                </span>
                <time className="entry-date published" dateTime={isoLocal(post.date)}>
                  {ymd(post.date)}
                </time>
              </div>
              <div className="post-entry blockquote-style-1">
                {html ? <div className="inner-post-entry entry-content" dangerouslySetInnerHTML={html} /> : <div className="inner-post-entry entry-content">{children}</div>}
              </div>
              <div className="tags-share-box page-share hide-tags tags-share-box-s1 center-box social-align-default">
                <span className="penci-social-share-text">Share</span>
                <ShareLinks url={abs} title={post.title} />
              </div>
              <div className="post-comments no-comment-yet penci-comments-hide-0" id="comments"></div>
            </article>
          </div>
        </div>
      </div>
    </>
  );
}
