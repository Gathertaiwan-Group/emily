import { db } from "@/lib/db";
import { listTerms, treeOrder } from "@/lib/cms/terms";
import { listAttributes } from "@/lib/cms/products";
import { decodeSlug } from "@/lib/cms/core";
import { deleteVariation, saveAttributes, saveProduct, saveVariation, trashProduct } from "../actions";
import { RichEditor } from "./RichEditor";
import { MediaField } from "./MediaField";
import { ConfirmButton } from "./ConfirmButton";
import { POST_STATUS_LABEL, localInput, money } from "./ui";

export async function ProductEditor({ p }: { p: any }) {
  const isNew = !p.id;
  const [cats, tagRows, attrs, attrTerms] = await Promise.all([
    listTerms("product_cat"),
    p.term_ids?.length ? db().from("terms").select("id,name,taxonomy").eq("taxonomy", "product_tag").in("id", p.term_ids) : Promise.resolve({ data: [] }),
    listAttributes(),
    listTerms().then((all) => all.filter((t) => t.taxonomy.startsWith("pa_"))),
  ]);
  const mediaIds = [p.featured_media_id, ...(p.gallery_media_ids ?? []), ...(p.variations ?? []).map((v: any) => v.image_id)].filter(Boolean);
  const media = mediaIds.length ? (((await db().from("media").select("id,public_url").in("id", mediaIds)).data ?? []) as any[]) : [];
  const url = new Map(media.map((m) => [m.id, m.public_url as string]));
  const isPublished = p.status === "publish" || p.status === "private";
  const varAttrs = (p.attributes ?? []).filter((a: any) => a.used_for_variations);
  return (
    <>
      <form action={saveProduct}>
        {p.id ? <input type="hidden" name="id" value={p.id} /> : null}
        <div className="adm-grid">
          <div>
            <input className="adm-title-input" name="name" defaultValue={p.name} placeholder="商品名稱" required aria-label="商品名稱" />
            <div className="adm-row" style={{ margin: "8px 0 12px", fontSize: 13 }}>
              <span>固定網址：</span>
              <code>/product/</code>
              <input name="slug" defaultValue={decodeSlug(p.slug ?? "")} placeholder="代稱" style={{ maxWidth: 300 }} aria-label="代稱" />
              {p.status === "publish" && p.link_path ? (
                <a href={p.link_path} target="_blank" rel="noreferrer">
                  檢視商品 ↗
                </a>
              ) : null}
            </div>
            <RichEditor name="description" initial={p.description ?? ""} minHeight={260} />

            <div className="adm-card" style={{ marginTop: 16 }}>
              <h2 className="adm-h2">商品資料</h2>
              <div className="adm-cols">
                <div>
                  <label className="adm-label">商品類型</label>
                  <select name="type" defaultValue={p.type ?? "simple"}>
                    <option value="simple">簡單商品</option>
                    <option value="variable">可變商品</option>
                    <option value="grouped">組合商品</option>
                    <option value="external">外部／聯盟商品</option>
                  </select>
                </div>
                <div>
                  <label className="adm-label">貨號（SKU）</label>
                  <input name="sku" defaultValue={p.sku ?? ""} />
                </div>
                <div>
                  <label className="adm-label">原價（NT$）</label>
                  <input type="number" step="0.01" min="0" name="regular_price" defaultValue={p.regular_price ?? ""} />
                </div>
                <div>
                  <label className="adm-label">特價（NT$）</label>
                  <input type="number" step="0.01" min="0" name="sale_price" defaultValue={p.sale_price ?? ""} />
                </div>
                <div>
                  <label className="adm-label">特價開始</label>
                  <input type="datetime-local" name="date_on_sale_from" defaultValue={localInput(p.date_on_sale_from)} />
                </div>
                <div>
                  <label className="adm-label">特價結束</label>
                  <input type="datetime-local" name="date_on_sale_to" defaultValue={localInput(p.date_on_sale_to)} />
                </div>
              </div>
              {p.type === "variable" ? <p className="adm-help">可變商品的價格與庫存在下方「變體」設定；商品價格顯示為最低變體價格（目前 {money(p.price)}）。</p> : null}
              <h3 className="adm-h2" style={{ marginTop: 16 }}>
                庫存
              </h3>
              <input type="hidden" name="stock_present" value="1" />
              <div className="adm-cols">
                <label style={{ alignSelf: "end" }}>
                  <input type="checkbox" name="manage_stock" defaultChecked={!!p.manage_stock} />
                  追蹤庫存數量
                </label>
                <div>
                  <label className="adm-label">庫存數量</label>
                  <input type="number" step="1" name="stock_quantity" defaultValue={p.stock_quantity ?? ""} />
                </div>
                <div>
                  <label className="adm-label">庫存狀態（不追蹤數量時）</label>
                  <select name="stock_status" defaultValue={p.stock_status ?? "instock"}>
                    <option value="instock">有庫存</option>
                    <option value="outofstock">缺貨</option>
                    <option value="onbackorder">可預購</option>
                  </select>
                </div>
                <div>
                  <label className="adm-label">允許缺貨下單</label>
                  <select name="backorders" defaultValue={p.backorders ?? "no"}>
                    <option value="no">不允許</option>
                    <option value="notify">允許，但通知顧客</option>
                    <option value="yes">允許</option>
                  </select>
                </div>
                <div>
                  <label className="adm-label">低庫存門檻</label>
                  <input type="number" name="low_stock_amount" defaultValue={p.low_stock_amount ?? ""} />
                </div>
                <div>
                  <label className="adm-label">最少購買數量</label>
                  <input type="number" min="1" name="min_purchase_qty" defaultValue={p.min_purchase_qty ?? 1} />
                </div>
                <div>
                  <label className="adm-label">最多購買數量</label>
                  <input type="number" min="1" name="max_purchase_qty" defaultValue={p.max_purchase_qty ?? ""} />
                </div>
              </div>
              <h3 className="adm-h2" style={{ marginTop: 16 }}>
                運送與其他
              </h3>
              <div className="adm-cols">
                <div>
                  <label className="adm-label">重量（kg）</label>
                  <input type="number" step="0.001" name="weight" defaultValue={p.weight ?? ""} />
                </div>
                <div>
                  <label className="adm-label">長 × 寬 × 高（cm）</label>
                  <div className="adm-row">
                    <input className="grow" type="number" step="0.01" name="length" defaultValue={p.length ?? ""} aria-label="長" style={{ width: 70 }} />
                    <input className="grow" type="number" step="0.01" name="width" defaultValue={p.width ?? ""} aria-label="寬" style={{ width: 70 }} />
                    <input className="grow" type="number" step="0.01" name="height" defaultValue={p.height ?? ""} aria-label="高" style={{ width: 70 }} />
                  </div>
                </div>
                <div>
                  <label className="adm-label">外部商品網址</label>
                  <input name="external_url" defaultValue={p.external_url ?? ""} />
                </div>
                <div>
                  <label className="adm-label">按鈕文字</label>
                  <input name="button_text" defaultValue={p.button_text ?? ""} />
                </div>
                <div>
                  <label className="adm-label">排序</label>
                  <input type="number" name="menu_order" defaultValue={p.menu_order ?? 0} />
                </div>
              </div>
              <input type="hidden" name="flags_present" value="1" />
              <div className="adm-row" style={{ marginTop: 10, gap: 16 }}>
                <label>
                  <input type="checkbox" name="virtual" defaultChecked={!!p.virtual} />
                  虛擬商品
                </label>
                <label>
                  <input type="checkbox" name="downloadable" defaultChecked={!!p.downloadable} />
                  可下載
                </label>
                <label>
                  <input type="checkbox" name="sold_individually" defaultChecked={!!p.sold_individually} />
                  每筆訂單限購一件
                </label>
                <label>
                  <input type="checkbox" name="reviews_allowed" defaultChecked={p.reviews_allowed ?? true} />
                  允許評價
                </label>
                <label>
                  <input type="checkbox" name="featured" defaultChecked={!!p.featured} />
                  精選商品
                </label>
              </div>
            </div>

            <div className="adm-card">
              <h2 className="adm-h2">商品簡短描述</h2>
              <RichEditor name="short_description" initial={p.short_description ?? ""} minHeight={140} />
            </div>
            <div className="adm-card">
              <h2 className="adm-h2">SEO（Rank Math）</h2>
              <label className="adm-label">SEO 標題</label>
              <input name="seo_title" defaultValue={p.seo?.title ?? ""} />
              <label className="adm-label">Meta 描述</label>
              <textarea name="seo_description" defaultValue={p.seo?.description ?? ""} rows={3} />
            </div>
          </div>
          <div>
            <div className="adm-card">
              <h2 className="adm-h2">發布</h2>
              <p style={{ margin: "0 0 6px" }}>
                狀態：<b>{POST_STATUS_LABEL[p.status] ?? p.status}</b>
              </p>
              {isPublished ? (
                <select name="status" defaultValue={p.status} aria-label="狀態">
                  <option value="publish">已發布</option>
                  <option value="private">私密</option>
                  <option value="draft">改為草稿（下架）</option>
                  <option value="pending">待審</option>
                </select>
              ) : null}
              <label className="adm-label">型錄可見度</label>
              <select name="catalog_visibility" defaultValue={p.catalog_visibility ?? "visible"}>
                <option value="visible">商店與搜尋結果</option>
                <option value="catalog">只在商店</option>
                <option value="search">只在搜尋結果</option>
                <option value="hidden">隱藏</option>
              </select>
              <div className="adm-row" style={{ marginTop: 12, justifyContent: "space-between" }}>
                {!isPublished ? (
                  <button className="adm-btn" name="intent" value="draft">
                    儲存草稿
                  </button>
                ) : null}
                {isPublished ? (
                  <button className="adm-btn primary" name="intent" value="save">
                    更新
                  </button>
                ) : (
                  <button className="adm-btn primary" name="intent" value="publish">
                    發布
                  </button>
                )}
              </div>
            </div>
            <div className="adm-card">
              <h2 className="adm-h2">商品分類</h2>
              <input type="hidden" name="cats_present" value="1" />
              <div className="adm-checklist">
                {treeOrder(cats).map((c) => (
                  <label key={c.id} style={{ paddingLeft: c.depth * 16 }}>
                    <input type="checkbox" name="category_ids" value={c.id} defaultChecked={(p.term_ids ?? []).includes(c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="adm-card">
              <h2 className="adm-h2">商品標籤</h2>
              <input name="tags" defaultValue={((tagRows.data ?? []) as any[]).map((t) => t.name).join(", ")} placeholder="以逗號分隔" />
            </div>
            <div className="adm-card">
              <h2 className="adm-h2">商品圖片</h2>
              <MediaField name="featured_media_id" initial={p.featured_media_id && url.get(p.featured_media_id) ? [{ id: p.featured_media_id, url: url.get(p.featured_media_id)! }] : []} label="設定商品圖片" />
            </div>
            <div className="adm-card">
              <h2 className="adm-h2">商品圖庫</h2>
              <MediaField name="gallery_media_ids" multiple initial={(p.gallery_media_ids ?? []).filter((id: number) => url.has(id)).map((id: number) => ({ id, url: url.get(id)! }))} label="新增圖庫圖片" />
            </div>
          </div>
        </div>
        {p.id && p.status !== "trash" ? (
          <p>
            <button className="adm-link-danger" formAction={trashProduct}>
              移到回收桶
            </button>
          </p>
        ) : null}
      </form>

      {!isNew ? (
        <>
          <div className="adm-card" id="attributes">
            <h2 className="adm-h2">屬性</h2>
            <form action={saveAttributes}>
              <input type="hidden" name="product_id" value={p.id} />
              {attrs.map((g) => {
                const cur = (p.attributes ?? []).find((a: any) => a.attribute_id === g.id);
                const opts = attrTerms.filter((t) => t.taxonomy === g.taxonomy);
                return (
                  <fieldset key={g.id} style={{ border: "1px solid #dcdcde", marginBottom: 10 }}>
                    <legend>
                      {g.name}（{g.taxonomy}）
                    </legend>
                    <div className="adm-row">
                      {opts.map((t) => (
                        <label key={t.id}>
                          <input type="checkbox" name={`attr_terms:${g.id}`} value={t.id} defaultChecked={(cur?.term_ids ?? []).map(Number).includes(t.id)} />
                          {t.name}
                        </label>
                      ))}
                    </div>
                    <div className="adm-row" style={{ marginTop: 6 }}>
                      <label>
                        <input type="checkbox" name={`attr_visible:${g.id}`} defaultChecked={cur ? cur.visible : true} />
                        顯示在商品頁
                      </label>
                      <label>
                        <input type="checkbox" name={`attr_var:${g.id}`} defaultChecked={!!cur?.used_for_variations} />
                        用於變體
                      </label>
                    </div>
                  </fieldset>
                );
              })}
              {(p.attributes ?? [])
                .filter((a: any) => !a.attribute_id)
                .map((a: any, i: number) => (
                  <fieldset key={i} style={{ border: "1px solid #dcdcde", marginBottom: 10 }}>
                    <legend>自訂屬性</legend>
                    <input type="hidden" name={`keep_custom:${i}`} value="1" />
                    <div className="adm-row">
                      <input name={`kc_name:${i}`} defaultValue={a.name} placeholder="名稱" style={{ maxWidth: 200 }} />
                      <input className="grow" name={`kc_options:${i}`} defaultValue={(a.options ?? []).join(" | ")} placeholder="值，以 | 分隔（清空即刪除）" />
                      <label>
                        <input type="checkbox" name={`kc_visible:${i}`} defaultChecked={a.visible} />
                        顯示
                      </label>
                      <label>
                        <input type="checkbox" name={`kc_var:${i}`} defaultChecked={a.used_for_variations} />
                        用於變體
                      </label>
                    </div>
                  </fieldset>
                ))}
              <fieldset style={{ border: "1px dashed #dcdcde", marginBottom: 10 }}>
                <legend>新增自訂屬性</legend>
                <div className="adm-row">
                  <input name="custom_name" placeholder="名稱，例如 尺寸" style={{ maxWidth: 200 }} />
                  <input className="grow" name="custom_options" placeholder="值，以 | 分隔，例如 S | M | L" />
                  <label>
                    <input type="checkbox" name="custom_visible" defaultChecked />
                    顯示
                  </label>
                  <label>
                    <input type="checkbox" name="custom_var" />
                    用於變體
                  </label>
                </div>
              </fieldset>
              <button className="adm-btn primary">儲存屬性</button>
            </form>
          </div>

          {p.type === "variable" ? (
            <div className="adm-card" id="variations">
              <h2 className="adm-h2">變體</h2>
              {!varAttrs.length ? <p className="adm-notice warn">請先在「屬性」勾選「用於變體」並儲存。</p> : null}
              {[...(p.variations ?? []), null].map((v: any) => (
                <form key={v?.id ?? "new"} action={saveVariation} style={{ borderTop: "1px solid #dcdcde", padding: "10px 0" }}>
                  <input type="hidden" name="product_id" value={p.id} />
                  {v ? <input type="hidden" name="variation_id" value={v.id} /> : null}
                  <div className="adm-row">
                    <b>{v ? `#${v.id}` : "新增變體"}</b>
                    {varAttrs.map((a: any) => {
                      const def = a.attribute_id ? attrs.find((g) => g.id === a.attribute_id) : undefined;
                      const key = def ? def.taxonomy : String(a.name).toLowerCase().replace(/\s+/g, "-");
                      const opts: { v: string; l: string }[] = def
                        ? attrTerms.filter((t) => (a.term_ids ?? []).map(Number).includes(t.id)).map((t) => ({ v: t.slug, l: t.name }))
                        : (a.options ?? []).map((o: string) => ({ v: o, l: o }));
                      return (
                        <select key={key} name={`attr:${key}`} defaultValue={v?.attributes?.[key] ?? ""} style={{ width: "auto" }} aria-label={a.name}>
                          <option value="">任何 {a.name}</option>
                          {opts.map((o) => (
                            <option key={o.v} value={o.v}>
                              {o.l}
                            </option>
                          ))}
                        </select>
                      );
                    })}
                  </div>
                  <div className="adm-cols" style={{ marginTop: 6 }}>
                    <div>
                      <label className="adm-label">貨號</label>
                      <input name="sku" defaultValue={v?.sku ?? ""} />
                    </div>
                    <div>
                      <label className="adm-label">原價</label>
                      <input type="number" step="0.01" min="0" name="regular_price" defaultValue={v?.regular_price ?? ""} />
                    </div>
                    <div>
                      <label className="adm-label">特價</label>
                      <input type="number" step="0.01" min="0" name="sale_price" defaultValue={v?.sale_price ?? ""} />
                    </div>
                    <div>
                      <label className="adm-label">庫存數量</label>
                      <input type="number" name="stock_quantity" defaultValue={v?.stock_quantity ?? ""} />
                    </div>
                    <div>
                      <label className="adm-label">庫存狀態</label>
                      <select name="stock_status" defaultValue={v?.stock_status ?? "instock"}>
                        <option value="instock">有庫存</option>
                        <option value="outofstock">缺貨</option>
                        <option value="onbackorder">可預購</option>
                      </select>
                    </div>
                    <div>
                      <label className="adm-label">變體圖片</label>
                      <MediaField name="image_id" initial={v?.image_id && url.get(v.image_id) ? [{ id: v.image_id, url: url.get(v.image_id)! }] : []} />
                    </div>
                  </div>
                  <div className="adm-row" style={{ marginTop: 6 }}>
                    <label>
                      <input type="checkbox" name="enabled" defaultChecked={!v || v.status === "publish"} />
                      啟用
                    </label>
                    <label>
                      <input type="checkbox" name="manage_stock" defaultChecked={!!v?.manage_stock} />
                      追蹤庫存
                    </label>
                    <input className="grow" name="description" defaultValue={v?.description ?? ""} placeholder="變體描述" />
                    <button className="adm-btn primary small">{v ? "儲存變體" : "新增變體"}</button>
                    {v ? (
                      <ConfirmButton message="刪除此變體？" formAction={deleteVariation} className="adm-btn small danger">
                        刪除
                      </ConfirmButton>
                    ) : null}
                  </div>
                </form>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
