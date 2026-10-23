"use client";
import { useState } from "react";

export default function CommentForm({ postId }: { postId: number }) {
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
    setBusy(true);
    try {
      const res = await fetch("/api/forms/comment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data, page_url: location.pathname }) });
      const j = await res.json();
      if (!res.ok) setMsg({ text: j.error ?? "送出失敗", error: true });
      else {
        setMsg({ text: j.message ?? "您的留言正在等待審核。" });
        if (fd.get("wp-comment-cookies-consent")) {
          try {
            localStorage.setItem("emily_commenter", JSON.stringify({ author: data.author, email: data.email, url: data.url }));
          } catch {}
        }
        (e.target as HTMLFormElement).reset();
      }
    } catch {
      setMsg({ text: "網路錯誤，請稍後再試。", error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div id="respond" className="comment-respond">
      <h3 id="reply-title" className="comment-reply-title">
        <span>Leave a Comment</span>
      </h3>
      {msg && <p className={`penci-notice${msg.error ? " error" : ""}`} role="status">{msg.text}</p>}
      <form action="/api/forms/comment" method="post" id="commentform" className="comment-form" onSubmit={onSubmit}>
        <p className="comment-form-comment">
          <textarea id="comment" name="comment" cols={45} rows={8} placeholder="Your Comment" aria-required="true" required></textarea>
        </p>
        <p className="comment-form-author">
          <input id="author" name="author" type="text" placeholder="Name*" size={30} aria-required="true" required />
        </p>
        <p className="comment-form-email">
          <input id="email" name="email" type="text" placeholder="Email*" size={30} aria-required="true" required />
        </p>
        <p className="comment-form-url">
          <input id="url" name="url" type="text" placeholder="Website" size={30} />
        </p>
        <p className="comment-form-cookies-consent">
          <input id="wp-comment-cookies-consent" name="wp-comment-cookies-consent" type="checkbox" value="yes" />
          <span className="comment-form-cookies-text">Save my name, email, and website in this browser for the next time I comment.</span>
        </p>
        <p className="form-submit">
          <input name="submit" type="submit" id="submit" className="submit" value={busy ? "Submitting..." : "Submit"} disabled={busy} />
          <input type="hidden" name="comment_post_ID" value={postId} id="comment_post_ID" />
          <input type="hidden" name="comment_parent" id="comment_parent" value="0" />
        </p>
      </form>
    </div>
  );
}
