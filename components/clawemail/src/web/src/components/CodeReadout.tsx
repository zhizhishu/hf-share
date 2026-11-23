import { useEffect, useState } from "react";

// 验证码：关键词附近取码；A-Z0-9 分支必须含数字，否则当英文单词丢弃
const CODE_NEAR_KEYWORD =
  /(?:code|验证码|校验码|动态码|otp|pin|passcode|确认码)[^0-9A-Za-z]{0,20}(?:(?:is|was|为|是)[^0-9A-Za-z]{0,6})?([0-9]{4,8}|[A-Z0-9]{6,8})/i;
// 退一步：独立的 6 位纯数字
const CODE_SIX_DIGITS = /(?<![0-9])([0-9]{6})(?![0-9])/;
// 验证链接：URL 里带这些词的第一个
const LINK_HINT = /verify|confirm|activate|magic|token|ticket|auth|login|signin/i;
// 退订 / 偏好设置链接也常带 token，排除
const LINK_SKIP = /unsubscribe|opt-?out|preferences|privacy/i;

function isHttps(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

export function extractCodes(subject: string, text: string): { code: string | null; link: string | null } {
  const haystack = `${subject}\n${text}`;

  let code: string | null = null;
  const near = CODE_NEAR_KEYWORD.exec(haystack);
  if (near) {
    const candidate = near[1];
    // 纯字母（如 "verifycode"）不算验证码
    if (/[0-9]/.test(candidate)) code = candidate;
  }
  if (!code) {
    const six = CODE_SIX_DIGITS.exec(haystack);
    if (six) code = six[1];
  }

  let link: string | null = null;
  const urls = haystack.match(/https?:\/\/[^\s"'<>()]+/gi) ?? [];
  for (const url of urls) {
    if (LINK_HINT.test(url) && !LINK_SKIP.test(url)) {
      link = url;
      break;
    }
  }

  return { code, link };
}

type Props = {
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  lang: "zh" | "en";
};

export function CodeReadout({ subject, text, html, lang }: Props) {
  const zh = lang === "zh";
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const plain = text && text.trim() ? text : html ? stripHtml(html) : "";
  const found = extractCodes(subject ?? "", plain);

  const fromHtml = html
    ? Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi), (m) => m[1].replace(/&amp;/gi, "&")).find(
        (href) => isHttps(href) && LINK_HINT.test(href) && !LINK_SKIP.test(href)
      )
    : undefined;
  const code = found.code;
  const link = fromHtml ?? found.link;
  if (!code && !link) return null;

  async function copy(value: string, kind: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      /* 剪贴板不可用：静默 */
    }
  }

  const copyLabel = (kind: "code" | "link") =>
    copied === kind ? (zh ? "已复制" : "Copied") : zh ? "复制" : "Copy";

  return (
    <div className="code-readout">
      {code && (
        <div className="cr-item">
          <span className="cr-lamp" aria-hidden="true" />
          <span className="cr-label">{zh ? "验证码" : "Code"}</span>
          <span className="cr-code mono">{code}</span>
          <button type="button" className="cr-copy" onClick={() => copy(code, "code")}>
            {copyLabel("code")}
          </button>
        </div>
      )}
      {link && (
        <div className="cr-item cr-link-row">
          <span className="cr-label">{zh ? "验证链接" : "Link"}</span>
          <a className="cr-link mono" href={link} target="_blank" rel="noreferrer noopener">
            {link}
          </a>
          <button type="button" className="cr-copy" onClick={() => copy(link, "link")}>
            {copyLabel("link")}
          </button>
        </div>
      )}
    </div>
  );
}
