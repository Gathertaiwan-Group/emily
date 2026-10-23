export type PickedMedia = { id: number; public_url: string; title: string; alt_text: string; width: number | null; height: number | null; mime_type: string };

/** Uploads one file to /admin/api/media. Large images are downscaled in the browser first (Vercel body limit ≈ 4.5 MB). */
export async function uploadFile(file: File): Promise<PickedMedia> {
  let body: Blob = file;
  if (file.size > 4 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) body = await shrink(file);
  if (body.size > 4.4 * 1024 * 1024) throw new Error(`${file.name}：檔案超過 4.4 MB，請先壓縮`);
  const fd = new FormData();
  fd.append("file", body, file.name);
  const res = await fetch("/admin/api/media", { method: "POST", body: fd });
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("壓縮失敗"))), "image/webp", 0.9));
}
