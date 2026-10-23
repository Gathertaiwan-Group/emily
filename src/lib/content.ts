/**
 * Post-processing of stored WordPress HTML before it is rendered:
 *  - Soledad lazy-load markup (data-bgset / data-src placeholders) is resolved server side so the
 *    content renders without the theme's jQuery lazy loader;
 *  - absolute links to the old domains become relative links.
 */
const OLD_HOSTS = /https?:\/\/(?:www\.)?(?:loveccdd\.com|l5910\.zeabur\.app)(?=[/"'?#)]|$)/g;
const OLD_HOSTS_ENC = /https?%3A%2F%2F(?:www\.)?(?:loveccdd\.com|l5910\.zeabur\.app)/gi;

export function transformContent(html: string | null | undefined): string {
  let s = String(html ?? "");
  s = s.replace(OLD_HOSTS, "");
  s = s.replace(OLD_HOSTS_ENC, "");
  // <div ... data-bgset="URL" ...> -> add background-image to style
  s = s.replace(/<([a-z]+)([^>]*?)\sdata-bgset="([^"]+)"([^>]*)>/gi, (_m, tag, a, url, b) => {
    let attrs = `${a}${b}`;
    const bg = `background-image: url('${url}');`;
    if (/\sstyle="/i.test(attrs)) attrs = attrs.replace(/\sstyle="/i, ` style="${bg}`);
    else attrs += ` style="${bg}"`;
    attrs = attrs.replace(/\bpenci-lazy\b/, "penci-lazy-done");
    return `<${tag}${attrs}>`;
  });
  // <img src="data:..." data-src="URL"> -> real src
  s = s.replace(/<img([^>]*?)\ssrc="data:image[^"]*"([^>]*?)\sdata-src="([^"]+)"([^>]*)>/gi, (_m, a, b, url, c) => `<img${a} src="${url}"${b}${c}>`);
  s = s.replace(/<img([^>]*?)\sdata-src="([^"]+)"([^>]*?)\ssrc="data:image[^"]*"([^>]*)>/gi, (_m, a, url, b, c) => `<img${a}${b} src="${url}"${c}>`);
  return s;
}
