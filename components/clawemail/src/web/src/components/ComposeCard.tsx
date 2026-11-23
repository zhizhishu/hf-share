import { Suspense, lazy, useEffect, useRef, useState, type ReactNode, type MouseEvent as RMouseEvent, type KeyboardEvent as RKeyboardEvent } from "react";
import { sendMail, replyMail, type MailDetail } from "../api";
import type { RichEditorHandle } from "./RichTextEditor";

// TipTap 约 100KB gzip，懒加载切出首屏主包；富文本模式才会拉这个 chunk
const RichTextEditor = lazy(() => import("./RichTextEditor").then((m) => ({ default: m.RichTextEditor })));
import { usePrefs } from "../i18n";

type Mode = "text" | "rich" | "html";

type Props = {
  open: boolean;
  fromMailbox: string;
  reply?: MailDetail | null; // 传入则进入“回复”模式（自动引用原文 + 走线程回复接口）
  onClose: () => void;
  onSent: (msg: string) => void;
  onError: (msg: string) => void;
};

const splitRecipients = (v: string) => v.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const stripHtml = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// 16px 线性 SVG 图标（替掉廉价感的 emoji，单色走 currentColor）
const svg = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">{path}</svg>
);
const Ico = {
  link: svg(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  image: svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" /></>),
  upload: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></>),
  eye: svg(<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  heading: svg(<><path d="M6 4v16M18 4v16M6 12h12" /></>),
  listUl: svg(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1.1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1.1" fill="currentColor" stroke="none" /></>),
  listOl: svg(<><path d="M10 6h11M10 12h11M10 18h11" /><path d="M4 5.5 5.2 5v3M3.6 15.2c.2-.7 1.6-.7 1.6.2 0 .6-.6.9-1.4 1.8h1.6" strokeWidth={1.4} /></>),
  quote: svg(<><path d="M7 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h2v2a2 2 0 0 1-2 2M18 7h-3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h2v2a2 2 0 0 1-2 2" /></>),
  code: svg(<><path d="m9 8-4 4 4 4M15 8l4 4-4 4" /></>)
};

export function ComposeCard({ open, fromMailbox, reply, onClose, onSent, onError }: Props) {
  const { lang } = usePrefs();
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState<Mode>("text");
  const [body, setBody] = useState("");       // text / html 源
  const [richHtml, setRichHtml] = useState(""); // 富文本 innerHTML
  const [replyAll, setReplyAll] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null); // 草稿「已保存」时间戳
  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false, ul: false, ol: false, block: "" });
  const richRef = useRef<RichEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);

  const draftKey = () => `clawemail:draft:${reply ? "r" + reply.id : "n:" + (fromMailbox || "_")}`;

  // 打开时初始化；回复模式自动引用原文（像 Gmail 应用上文）；新建则尝试恢复草稿
  useEffect(() => {
    if (!open) return;
    setCc(""); setBcc(""); setShowCcBcc(false); setReplyAll(false); setPreview(false); setBusy(false); setSavedAt(null);
    if (reply) {
      setTo(reply.source || "");
      setSubject(/^re:/i.test(reply.subject || "") ? reply.subject || "" : `Re: ${reply.subject || ""}`);
      const when = reply.received_at || reply.created_at || "";
      const origText = reply.text || stripHtml(reply.html || "");
      const quoted =
        `<p><br></p><div style="color:#888;font-size:13px">${L("在", "On")} ${esc(when)}，${esc(reply.source || "")} ${L("写道：", "wrote:")}</div>` +
        `<blockquote style="margin:6px 0 0;padding-left:12px;border-left:2px solid #ccc;color:#666">` +
        `${reply.html || esc(origText).replace(/\n/g, "<br>")}</blockquote>`;
      setMode("rich");
      setRichHtml(quoted);
      setBody(`\n\n${L("在", "On")} ${when}，${reply.source || ""} ${L("写道：", "wrote:")}\n` + origText.split("\n").map((l) => "> " + l).join("\n"));
      return;
    }
    // 新建：尝试恢复上次未发出的草稿
    let restored = false;
    try {
      const raw = localStorage.getItem(draftKey());
      if (raw) {
        const d = JSON.parse(raw);
        if (d && (d.to || d.subject || d.body || d.richHtml)) {
          setTo(d.to || ""); setCc(d.cc || ""); setBcc(d.bcc || ""); setShowCcBcc(Boolean(d.cc || d.bcc));
          setSubject(d.subject || ""); setMode((d.mode as Mode) || "text");
          setBody(d.body || ""); setRichHtml(d.richHtml || "");
          setSavedAt(d.ts ? clock(d.ts) : null);
          restored = true;
        }
      }
    } catch { /* 坏草稿忽略 */ }
    if (!restored) { setTo(""); setSubject(""); setMode("text"); setBody(""); setRichHtml(""); }
  }, [open, reply]);

  // 切到富文本时把内容灌进编辑器（TipTap 受控：只在外部值变化时 setContent）
  useEffect(() => {
    if (open && mode === "rich" && !preview && richRef.current && richRef.current.innerHTML !== richHtml) {
      richRef.current.setHTML(richHtml);
    }
  }, [open, mode, preview]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 草稿自动保存：任一字段变动 700ms 后落 localStorage，显示「已保存 · HH:MM」
  useEffect(() => {
    if (!open) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const rich = richRef.current?.innerHTML ?? richHtml;
      const empty = !to.trim() && !cc.trim() && !bcc.trim() && !subject.trim() && !body.trim() && !stripHtml(rich);
      try {
        if (empty) { localStorage.removeItem(draftKey()); return; }
        const ts = Date.now();
        localStorage.setItem(draftKey(), JSON.stringify({ to, cc, bcc, subject, mode, body, richHtml: rich, ts }));
        setSavedAt(clock(ts));
      } catch { /* 配额满则跳过 */ }
    }, 700);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [open, to, cc, bcc, subject, body, richHtml, mode]);

  if (!open) return null;

  function switchMode(m: Mode) {
    if (m === mode) return;
    if (mode === "rich") {
      const h = richRef.current?.innerHTML ?? richHtml;
      setRichHtml(h);
      setBody(h); // 富文本 → 文本/HTML：保留 HTML 源
    } else if (m === "rich") {
      setRichHtml(body || "");
    }
    setMode(m);
  }

  function refreshFmt() {
    const s = richRef.current?.state();
    if (s) setFmt(s);
  }
  function exec(cmd: string, val?: string) {
    richRef.current?.focus();
    richRef.current?.run(cmd, val);
    setRichHtml(richRef.current?.innerHTML ?? "");
    refreshFmt();
  }
  function toggleBlock(tag: string) {
    const cur = (document.queryCommandValue("formatBlock") || "").toLowerCase();
    exec("formatBlock", cur === tag ? "p" : tag);
  }
  function insertCode() {
    richRef.current?.focus();
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString() : "";
    exec("insertHTML", `<code>${text ? esc(text) : L("代码", "code")}</code>&nbsp;`);
  }
  function promptLink() {
    const u = prompt(L("链接 URL：", "Link URL:"));
    if (u && u.trim()) exec("createLink", u.trim());
  }
  // 工具按钮统一 onMouseDown（preventDefault 保住选区，点击不丢焦点）
  const mdCmd = (cmd: string) => (e: RMouseEvent) => { e.preventDefault(); exec(cmd); };
  const mdBlock = (tag: string) => (e: RMouseEvent) => { e.preventDefault(); toggleBlock(tag); };

  function onRichKeyDown(e: RKeyboardEvent<HTMLDivElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); exec("bold"); }
    else if (k === "i") { e.preventDefault(); exec("italic"); }
    else if (k === "u") { e.preventDefault(); exec("underline"); }
    else if (k === "k") { e.preventDefault(); promptLink(); }
  }

  function insertImg(src: string) {
    const tag = `<img src="${src}" style="max-width:100%" alt="" />`;
    if (mode === "rich") {
      exec("insertHTML", tag);
    } else {
      setBody((b) => (b ? b + "\n" : "") + tag);
      if (mode === "text") setMode("html");
    }
  }
  function linkImage() {
    const url = prompt(L("图片链接 URL：", "Image URL:"));
    if (url && url.trim()) insertImg(url.trim());
  }
  function uploadImage(file: File) {
    if (!file.type.startsWith("image/")) { onError(L("请选图片文件", "Pick an image file")); return; }
    if (file.size > 1.5 * 1024 * 1024) { onError(L("图片过大(>1.5MB)，建议改用「链接图片」", "Image too big (>1.5MB), use Link image instead")); return; }
    const r = new FileReader();
    r.onload = () => { if (typeof r.result === "string") insertImg(r.result); };
    r.onerror = () => onError(L("读取图片失败", "Failed to read image"));
    r.readAsDataURL(file);
  }

  function currentBody(): { content: string; html: boolean } {
    if (mode === "rich") return { content: richRef.current?.innerHTML ?? richHtml, html: true };
    if (mode === "html") return { content: body, html: true };
    return { content: body, html: false };
  }

  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch { /* noop */ }
  }
  function handleClear() {
    if (!confirm(L("清空正文？此操作不可撤销。", "Clear the body? This cannot be undone."))) return;
    setBody(""); setRichHtml("");
    if (richRef.current) richRef.current?.setHTML("");
    setSavedAt(null);
    clearDraft();
    refreshFmt();
  }

  async function handleSend() {
    const { content, html } = currentBody();
    setBusy(true);
    try {
      if (reply) {
        await replyMail({ mailId: reply.id, body: content, html, toAll: replyAll });
        onSent(L("回复已发送", "Reply sent"));
      } else {
        const toList = splitRecipients(to);
        if (!fromMailbox || toList.length === 0) { setBusy(false); return; }
        await sendMail({
          from: fromMailbox,
          to: toList,
          cc: cc ? splitRecipients(cc) : undefined,
          bcc: bcc ? splitRecipients(bcc) : undefined,
          subject: subject || undefined,
          body: content || undefined,
          html
        });
        onSent(L("邮件已发送", "Mail sent"));
      }
      clearDraft();
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canSend = reply ? true : Boolean(fromMailbox) && splitRecipients(to).length > 0;
  const { content: pvContent, html: pvHtml } = currentBody();
  const previewSrc = pvHtml ? pvContent : `<pre style="white-space:pre-wrap;font-family:ui-sans-serif,system-ui;font-size:14px;color:#111">${esc(pvContent)}</pre>`;

  // 实时字数/字符统计（富文本/HTML 去标签后计；CJK 逐字、拉丁按词组）
  const plain = mode === "text" ? body : stripHtml(mode === "rich" ? richHtml : body);
  const chars = [...plain].length;
  const words = (plain.match(/[㐀-鿿豈-﫿]/g)?.length || 0) + (plain.match(/[A-Za-z0-9À-ɏ]+/g)?.length || 0);
  const hasContent = Boolean(plain.trim()) || Boolean((mode === "rich" ? richHtml : body).trim());

  return (
    <div className="compose-overlay" onClick={onClose}>
      <div className="compose-card" role="dialog" aria-label={reply ? L("回复", "Reply") : L("写邮件", "Compose")} onClick={(e) => e.stopPropagation()}>
        <header className="compose-head">
          <h2>{reply ? L("回复", "Reply") : L("写邮件", "Compose")}<span className="dot-accent">.</span></h2>
          <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
        </header>

        <div className="compose-fields">
          <div className="cf-row"><span className="cf-k">{L("发件人", "From")}</span><span className="cf-static">{fromMailbox || "—"}</span></div>
          <div className="cf-row"><span className="cf-k">{L("收件人", "To")}</span>
            {reply
              ? <span className="cf-static">{to || "—"}</span>
              : <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="alice@example.com, bob@example.com" />}
            {!reply && <button className="mini-link cf-ccbtn" onClick={() => setShowCcBcc((s) => !s)}>{showCcBcc ? L("收起", "hide") : L("抄送/密送", "cc/bcc")}</button>}
          </div>
          {!reply && showCcBcc && (
            <>
              <div className="cf-row"><span className="cf-k">{L("抄送", "Cc")}</span><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder={L("可选", "optional")} /></div>
              <div className="cf-row"><span className="cf-k">{L("密送", "Bcc")}</span><input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder={L("可选", "optional")} /></div>
            </>
          )}
          <div className="cf-row"><span className="cf-k">{L("主题", "Subject")}</span><input className="cf-subj" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={L("主题", "Subject")} /></div>
          {reply && <label className="cf-replyall"><input type="checkbox" checked={replyAll} onChange={(e) => setReplyAll(e.target.checked)} />{L("回复全部", "Reply all")}</label>}
        </div>

        <div className="compose-toolbar">
          <div className="seg">
            {(["text", "rich", "html"] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => switchMode(m)}>
                {m === "text" ? L("纯文本", "Text") : m === "rich" ? L("富文本", "Rich") : "HTML"}
              </button>
            ))}
          </div>
          {mode === "rich" && !preview && (
            <>
              <span className="tb-div" />
              <div className="rt-tools">
                <button className={`tb-btn tb-glyph ${fmt.bold ? "on" : ""}`} onMouseDown={mdCmd("bold")} title={L("加粗 (Ctrl+B)", "Bold (Ctrl+B)")}><b>B</b></button>
                <button className={`tb-btn tb-glyph ${fmt.italic ? "on" : ""}`} onMouseDown={mdCmd("italic")} title={L("斜体 (Ctrl+I)", "Italic (Ctrl+I)")}><i>I</i></button>
                <button className={`tb-btn tb-glyph ${fmt.underline ? "on" : ""}`} onMouseDown={mdCmd("underline")} title={L("下划线 (Ctrl+U)", "Underline (Ctrl+U)")}><u>U</u></button>
                <span className="tb-div" />
                <button className={`tb-btn ${fmt.block === "h3" ? "on" : ""}`} onMouseDown={mdBlock("h3")} title={L("标题", "Heading")}>{Ico.heading}</button>
                <button className={`tb-btn ${fmt.ul ? "on" : ""}`} onMouseDown={mdCmd("insertUnorderedList")} title={L("项目符号列表", "Bulleted list")}>{Ico.listUl}</button>
                <button className={`tb-btn ${fmt.ol ? "on" : ""}`} onMouseDown={mdCmd("insertOrderedList")} title={L("编号列表", "Numbered list")}>{Ico.listOl}</button>
                <span className="tb-div" />
                <button className="tb-btn" onMouseDown={(e) => { e.preventDefault(); promptLink(); }} title={L("链接 (Ctrl+K)", "Link (Ctrl+K)")}>{Ico.link}</button>
                <button className={`tb-btn ${fmt.block === "blockquote" ? "on" : ""}`} onMouseDown={mdBlock("blockquote")} title={L("引用", "Quote")}>{Ico.quote}</button>
                <button className="tb-btn" onMouseDown={(e) => { e.preventDefault(); insertCode(); }} title={L("代码", "Code")}>{Ico.code}</button>
              </div>
            </>
          )}
          <span className="tb-spacer" />
          <button className="tb-btn" onClick={linkImage} title={L("插入图片链接", "Image by URL")}>{Ico.image}</button>
          <button className="tb-btn" onClick={() => fileRef.current?.click()} title={L("上传图片", "Upload image")}>{Ico.upload}</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} />
          <span className="tb-div" />
          <button className={`tb-btn ${preview ? "on" : ""}`} onClick={() => setPreview((p) => !p)} title={L("预览", "Preview")}>{Ico.eye}</button>
        </div>

        <div className={`compose-body ${preview ? "is-preview" : ""}`}>
          {preview ? (
            <iframe className="compose-preview" title="preview" sandbox="" srcDoc={previewSrc} />
          ) : mode === "rich" ? (
            <Suspense fallback={<div className="rt-area rt-loading">{L("载入编辑器…", "loading editor…")}</div>}>
              <RichTextEditor
                ref={richRef}
                initialHTML={richHtml}
                placeholder={L("正文…", "Body…")}
                onChange={(html: string) => setRichHtml(html)}
              />
            </Suspense>
          ) : (
            <textarea className="compose-text" value={body} onChange={(e) => setBody(e.target.value)} placeholder={mode === "html" ? L("HTML 源码…", "HTML source…") : L("正文…", "Body…")} />
          )}
        </div>

        <div className="compose-stats">
          <span className="cs-count">
            <b>{words}</b> {L("词", "words")}<span className="cs-dot">·</span><b>{chars}</b> {L("字符", "chars")}
          </span>
          {savedAt && <span className="cs-saved" aria-live="polite"><span className="cs-tick" />{L("已保存", "Saved")} {savedAt}</span>}
          <button className="cs-clear" onClick={handleClear} disabled={busy || !hasContent}>{L("清空", "Clear")}</button>
        </div>

        <footer className="compose-foot">
          <button className="ghost" onClick={onClose} disabled={busy}>{L("取消", "Cancel")}</button>
          <button className="primary" onClick={handleSend} disabled={busy || !canSend}>{busy ? L("发送中…", "Sending…") : L("发送", "Send")}</button>
        </footer>
      </div>
    </div>
  );
}
