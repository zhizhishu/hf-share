import { useEffect, useMemo, useState } from "react";
import { fetchExtConfig, type ExtConfig } from "../api";
import { usePrefs } from "../i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
  onStatus: (msg: string) => void;
};

const origin = typeof window !== "undefined" ? window.location.origin : "";

type Block =
  | { kind: "p"; text: string }
  | { kind: "kv"; rows: Array<[string, string]> }
  | { kind: "code"; code: string; note?: string }
  | { kind: "note"; text: string };

type Section = { id: string; title: string; desc?: string; blocks: Block[] };

function buildSections(ext: ExtConfig | null): Section[] {
  const base = origin + (ext?.pathPrefix || "/ext");
  const dom0 = ext?.domains?.[0] || "claw.163.com";
  const site = ext?.sitePassword ? ' -H "x-custom-auth: <站点口令>"' : "";
  const admin = '-H "x-admin-auth: <后台口令>"';
  const bearer = '-H "Authorization: Bearer <jwt>"';

  return [
    {
      id: "overview",
      title: "概览",
      desc: "一个出口统管所有邮箱（claw 子邮箱 + 临时邮箱），按域名分流，对齐标准 cloudflare_temp_email 协议。",
      blocks: [
        { kind: "kv", rows: [["服务地址 (API base)", base], ["可用域名", (ext?.domains || []).join("、") || "—"]] },
        { kind: "p", text: "下面所有路径都拼在服务地址后面。" }
      ]
    },
    {
      id: "auth",
      title: "鉴权",
      desc: "三层身份，按用途选一个；站点口令（若设置）每个请求都要带。",
      blocks: [
        {
          kind: "kv",
          rows: [
            ["x-admin-auth", "管理员口令 —— 可指定任意邮箱"],
            ["x-custom-auth", "站点口令 —— 设了就必须带"],
            ["Authorization: Bearer <jwt>", "每址令牌 —— 建址时返回，只能操作该地址"]
          ]
        },
        { kind: "note", text: "真实口令在「设置 → 对外出口」里复制，只在后台可见。" }
      ]
    },
    {
      id: "admin",
      title: "管理员 · 指定任意邮箱",
      blocks: [
        {
          kind: "code",
          note: "建一个地址，返回 { address, jwt, address_id }",
          code: `curl -X POST ${base}/admin/new_address \\
  ${admin}${site} \\
  -H "content-type: application/json" \\
  -d '{"name":"abc","domain":"${dom0}"}'`
        },
        { kind: "code", note: "列出所有地址", code: `curl ${base}/admin/address ${admin}${site}` },
        {
          kind: "code",
          note: "取某个地址的每址令牌",
          code: `curl "${base}/admin/show_password?address=abc@${dom0}" ${admin}${site}`
        },
        {
          kind: "code",
          note: "读指定地址的信（parsed=true 返回解析后的正文）",
          code: `curl "${base}/admin/mails?address=abc@${dom0}&parsed=true&limit=10" ${admin}${site}`
        },
        {
          kind: "code",
          note: "以指定地址发信",
          code: `curl -X POST ${base}/admin/send_mail ${admin}${site} \\
  -H "content-type: application/json" \\
  -d '{"from":"abc@${dom0}","to_mail":"x@y.com","subject":"hi","content":"正文","is_html":false}'`
        }
      ]
    },
    {
      id: "address",
      title: "每址 · 只管自己",
      desc: "用建址时返回的 jwt，只能读写这一个地址。",
      blocks: [
        { kind: "code", note: "列表（解析后）", code: `curl "${base}/api/parsed_mails?limit=10" ${bearer}${site}` },
        { kind: "code", note: "列表（原始）", code: `curl "${base}/api/mails?limit=10" ${bearer}${site}` },
        {
          kind: "code",
          note: "单封解析（含 attachments[] 元数据）",
          code: `curl "${base}/api/parsed_mail/<id>" ${bearer}${site}`
        },
        { kind: "code", note: "单封原始", code: `curl "${base}/api/mail/<id>" ${bearer}${site}` },
        {
          kind: "code",
          note: "下载附件（part_id 取自 attachments[].id）",
          code: `curl "${base}/api/mail/<id>/attachment/<part_id>" ${bearer}${site} -o file`
        },
        {
          kind: "code",
          note: "以该地址发信",
          code: `curl -X POST ${base}/api/send_mail ${bearer}${site} \\
  -H "content-type: application/json" \\
  -d '{"to_mail":"x@y.com","subject":"hi","content":"正文"}'`
        },
        { kind: "code", note: "自己的设置", code: `curl ${base}/api/settings ${bearer}${site}` }
      ]
    },
    {
      id: "public",
      title: "公开",
      blocks: [{ kind: "code", note: "可用域名，无需鉴权", code: `curl ${base}/open_api/settings` }]
    },
    {
      id: "webhook",
      title: "到信推送",
      desc: "在「设置 → 对外出口」填 webhook URL，任一邮箱收到新信即 POST，免轮询。",
      blocks: [
        {
          kind: "code",
          note: "推送体",
          code: `{
  "type": "mail.received",
  "address": "<邮箱>",
  "mailbox": "<邮箱>",
  "id": <本地 id>,
  "from": "...",
  "subject": "..."
}`
        },
        { kind: "p", text: "收到推送后用该地址的 jwt 调 /api/mail/<id> 取正文。" }
      ]
    },
    {
      id: "compat",
      title: "字段兼容",
      blocks: [
        {
          kind: "kv",
          rows: [
            ["收件人字段", "to_mail | to"],
            ["正文字段", "content | text | body"],
            ["HTML 开关", "is_html | html"]
          ]
        },
        { kind: "note", text: "claw 与 edu 的收发都不需要外部 SMTP；发信有日限额，可在设置里调整。" }
      ]
    }
  ];
}

export function DocsModal({ open, onClose, onError, onStatus }: Props) {
  const { lang } = usePrefs();
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [ext, setExt] = useState<ExtConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchExtConfig().then(setExt).catch((e) => onError(e instanceof Error ? e.message : String(e)));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onError]);

  const sections = useMemo(() => buildSections(ext), [ext]);

  if (!open) return null;

  function copy(text: string, okMsg = L("已复制", "copied")) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => onStatus(okMsg)).catch(() => onError(L("复制失败", "copy failed")));
    }
  }

  return (
    <div className="compose-overlay" onClick={onClose}>
      <div className="compose-card docs-card" role="dialog" aria-label="API docs" onClick={(e) => e.stopPropagation()}>
        <header className="compose-head">
          <h2>{L("API 调用文档", "API docs")}<span className="dot-accent">.</span></h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="mini-link" onClick={() => copy(sections.map((s) => `## ${s.title}\n${s.blocks.map((b) => (b.kind === "code" ? b.code : b.kind === "kv" ? b.rows.map(([k, v]) => `${k}: ${v}`).join("\n") : "text" in b ? b.text : "")).join("\n\n")}`).join("\n\n"), L("文档已复制", "Docs copied"))}>
              {L("复制全部", "copy all")}
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="close">×</button>
          </div>
        </header>

        <div className="docs-split">
          <nav className="docs-nav" aria-label={L("文档目录", "doc sections")}>
            {sections.map((s) => (
              <button
                key={s.id}
                className="docs-nav-item"
                onClick={() => document.getElementById(`doc-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                {s.title}
              </button>
            ))}
          </nav>

          <div className="docs-main">
            {sections.map((s) => (
              <section className="docs-sec" id={`doc-${s.id}`} key={s.id}>
                <h3 className="docs-h">{s.title}</h3>
                {s.desc && <p className="docs-desc">{s.desc}</p>}
                {s.blocks.map((b, i) => {
                  if (b.kind === "p") return <p className="docs-p" key={i}>{b.text}</p>;
                  if (b.kind === "note") return <p className="docs-note" key={i}>{b.text}</p>;
                  if (b.kind === "kv") {
                    return (
                      <dl className="docs-kv" key={i}>
                        {b.rows.map(([k, v]) => (
                          <div className="docs-kv-row" key={k}>
                            <dt>{k}</dt>
                            <dd><code>{v}</code></dd>
                          </div>
                        ))}
                      </dl>
                    );
                  }
                  return (
                    <figure className="docs-code" key={i}>
                      <figcaption>
                        <span>{b.note || ""}</span>
                        <button className="mini-link" onClick={() => copy(b.code)}>{L("复制", "copy")}</button>
                      </figcaption>
                      <pre><code>{b.code}</code></pre>
                    </figure>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
