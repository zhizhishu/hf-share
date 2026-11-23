// 临时邮箱 provider 客户端（多实例）。按 provider.type 分流：
//   - "php": 自建 PHP 临时邮箱（webhostmost / edu，X-Admin-Password，action=external_*）—— 全功能
//   - "cf" : cloudflare_temp_email (dreamhunter2333) 标准接口。canonical 契约：
//       建址:    POST /admin/new_address (头 x-admin-auth) → {jwt, address, password, address_id}
//       读信:    GET  /api/parsed_mails?limit=&offset= (头 Authorization: Bearer <该址 jwt>) → {results, count}
//                解析字段 = {id, message_id, source, address, sender, subject, text, html, created_at, attachments}
//       发信:    POST /admin/send_mail (头 x-admin-auth) {from_mail, to_mail, subject, content, is_html} → {status:"ok"}
//       列地址:  GET /admin/address?limit=&offset= (头 x-admin-auth) → {results:[{name,address,created_at,...}],count} 全量分页；
//          不可用(非 canonical)才退回面板本地记账(app_settings cf.addresses.<id>)。读某址先 mint 一把该址 jwt 再读 /api/parsed_mails。
//          ⚠ cfMint 依赖 new_address 同名幂等刷 jwt；真 canonical admin/new_address 对已存在地址可能非幂等，
//            待 roastalpha-cf 上线后改走 /admin/show_password/:id 或 /admin/mails?address= 实测校准。
import type { TempProvider } from "./temp-providers";
import { fetchIcloudBodies, fetchIcloudBody } from "./icloud-imap";
import { retryAsync } from "./http-retry";
import { getSetting, setSetting } from "./db";

export type CfAlias = {
  address: string;
  local: string;
  createdAt: string | null;
  forwardEnabled?: boolean;
  forwardTo?: string[];
  id?: string | number;
};
export type CfMessageSummary = {
  uid: number;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  preview: string | null;
  // icloud-hme 引擎解析出的 HTML 正文（验证链接常只在 HTML 里）；其它源走 bodyHtml 字段
  bodyHtml?: string | null;
  // canonical passthrough：上游有则带出，无则降级（messageId 缺省 undefined、attachments 缺省 []）
  messageId?: string;
  attachments?: Array<{ filename: string; mimeType: string; size: number }>;
};
export type CfMessageDetail = CfMessageSummary & {
  recipientHint?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
};
export type CfSendInput = { from: string; to: string[]; subject?: string; body?: string; html?: boolean };
export type CfForwarding = { enabled: boolean; forwardTo: string[]; forwardedUids?: number[] };

function localOf(addr: string): string { return (addr || "").split("@")[0]; }
function fullAddr(provider: TempProvider, local: string): string {
  return local.includes("@") ? local : `${local}@${provider.domain}`;
}
function snippet(s: string | null | undefined, n = 140): string | null {
  if (!s) return null;
  const t = String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) : t;
}

/* ===================== php 类型 ===================== */
type PhpApiOptions = { method?: "GET" | "POST"; query?: Record<string, string | number | undefined>; body?: unknown; form?: Record<string, string | number | boolean | undefined> };
async function phpApi<T = any>(provider: TempProvider, action: string, options: PhpApiOptions = {}): Promise<T> {
  const url = new URL(provider.endpoint);
  url.searchParams.set("action", action);
  for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { "X-Admin-Password": provider.password };
  const init: RequestInit = { method: options.method ?? "GET", headers };
  if (options.form !== undefined) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.form)) if (v !== undefined) params.set(k, String(v));
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = params.toString(); init.method = "POST";
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json"; init.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && (data.error || data.message)) || `temp-mail HTTP ${res.status}`);
  return data as T;
}

/* ===================== cf 类型（cloudflare_temp_email 壳） ===================== */
// 本地记账：面板建过的地址前缀（cf 壳没有远端列表口子）
function cfNames(provider: TempProvider): string[] {
  try { const v = JSON.parse(getSetting(`cf.addresses.${provider.id}`) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function cfAddName(provider: TempProvider, local: string): void {
  const list = cfNames(provider);
  if (!list.includes(local)) { list.push(local); setSetting(`cf.addresses.${provider.id}`, JSON.stringify(list)); }
}
function cfRemoveName(provider: TempProvider, local: string): void {
  setSetting(`cf.addresses.${provider.id}`, JSON.stringify(cfNames(provider).filter((n) => n !== local)));
}

// 建/取地址：new_address 同名幂等 → 每次拿到新鲜 jwt（自动解决 24h 过期）
async function cfMint(provider: TempProvider, local: string): Promise<{ address: string; jwt: string; addressId?: string }> {
  const res = await fetch(provider.endpoint.replace(/\/+$/, "") + "/admin/new_address", {
    method: "POST",
    headers: { "x-admin-auth": provider.password, "content-type": "application/json" },
    body: JSON.stringify({ name: local, domain: provider.domain, enablePrefix: false })
  });
  const text = await res.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
  if (!res.ok || !j?.jwt) throw new Error(j?.error || j?.message || `cf new_address HTTP ${res.status}`);
  return { address: j.address || fullAddr(provider, local), jwt: j.jwt, addressId: j.address_id };
}

// 读解析信。上游并发下会偶发 "service not seeded"（seed 竞态）或 5xx，
// 故整段（mint + 读）包重试：每次重试都重新 mint，等于重新 seed。
// mint 走 new_address 同名幂等、读是 GET，两者都安全可重试。
async function cfReadParsed(provider: TempProvider, local: string, limit = 50): Promise<any[]> {
  return retryAsync(async () => {
    const { jwt } = await cfMint(provider, local);
    const res = await fetch(provider.endpoint.replace(/\/+$/, "") + `/api/parsed_mails?limit=${limit}`, {
      headers: { authorization: `Bearer ${jwt}` }
    });
    const text = await res.text();
    let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
    if (!res.ok) throw new Error(j?.error || j?.message || `cf parsed_mails HTTP ${res.status}`);
    return Array.isArray(j) ? j : (j?.results ?? j?.mails ?? []);
  });
}

// canonical cf parsed 字段：{id, message_id, sender, source, subject, text, html, address, created_at, attachments}
function cfMap(m: any, alias: string): CfMessageSummary {
  // 附件：roastalpha 字段存在但常为空；两台临时服务器字段名可能是 mimeType 或 mime，两者都容忍
  const attachments = Array.isArray(m.attachments)
    ? m.attachments.map((a: any) => ({
        filename: String(a.filename ?? ""),
        mimeType: String(a.mimeType ?? a.mime ?? ""),
        size: Number(a.size ?? 0)
      }))
    : [];
  return {
    uid: Number(m.id ?? 0),
    subject: m.subject ?? null,
    // 发件人：roastalpha 用 sender/source；edu 用 from_address/from_name；再兜底 from
    from: m.sender ?? m.source ?? m.from_address ?? m.from_name ?? m.from ?? null,
    to: m.address ?? alias,
    date: m.created_at ?? null,
    preview: snippet(m.text),
    messageId: m.message_id != null ? String(m.message_id) : undefined,
    attachments
  };
}

/* ===================== icloud 类型（icloud-hme Go 服务壳） ===================== */
// 全部 /api/* 走 Basic Auth（user 固定 "claw"，pass = provider.password）；
// 返回统一 {success,data} 或 {success:false,message}——success=false 或非 2xx 一律抛，成功返回 data。

// 引擎业务性 4xx（错误信封 {success:false,code,message}）：带引擎原始状态码抛出，
// 由 server/index.ts 全局 errorHandler 映射成同状态码 4xx 响应（message 原样透传）。
// 5xx / 网络错误仍抛普通 Error → 500。
export class EngineHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EngineHttpError";
    this.status = status;
    this.code = code;
  }
}

async function icloudApi<T = any>(
  provider: TempProvider,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const base = provider.endpoint.replace(/\/+$/, "");
  const auth = Buffer.from(`claw:${provider.password}`).toString("base64");
  const headers: Record<string, string> = { Authorization: `Basic ${auth}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  const text = await res.text();
  let j: any = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok || (j && j.success === false)) {
    // 引擎业务性 4xx + 错误信封：带 status/code/message 抛，路由层透传同状态码；
    // 其余（5xx、网络错误、非信封 4xx）仍走普通 Error → 500。
    if (res.status >= 400 && res.status < 500 && j && j.success === false) {
      throw new EngineHttpError(
        res.status,
        String(j.code ?? "ERROR"),
        String(j.message || j.error || `icloud HTTP ${res.status}`)
      );
    }
    throw new Error((j && (j.message || j.error)) || `icloud HTTP ${res.status}`);
  }
  return (j?.data) as T;
}

// 取多账号 account_id：优先 provider.accountId，否则 /api/accounts 取第一个；都取不到抛。
async function icloudAccountId(provider: TempProvider): Promise<string> {
  if (provider.accountId) return provider.accountId;
  const accounts = await icloudApi<Array<{ id: string }> | null>(provider, "GET", "/api/accounts");
  const id = accounts?.[0]?.id;
  if (!id) throw new Error("未配置 iCloud 账号");
  return String(id);
}

/* ===================== 对外统一接口（按 type 分流） ===================== */
export function cfDomain(provider: TempProvider): string {
  if (provider.type === "icloud") return provider.domain || "icloud.com";
  return provider.domain;
}

export async function cfStatus(provider: TempProvider): Promise<any> {
  if (provider.type === "icloud") {
    // GET /api/accounts 通即视为已连（失败抛，让面板显未连）
    await icloudApi(provider, "GET", "/api/accounts");
    return { domain: cfDomain(provider) };
  }
  if (provider.type === "cf") {
    // 用只读 admin 端点 /admin/address 验证 x-admin-auth（200=通）。
    // ⚠ 不再 mint "healthcheck" 探针地址——那会往服务器地址表登记一条永久记录、反复污染列表
    //   （历史上 edu/roastalpha 的 healthcheck 就是这里反复建出来的）。
    const base = provider.endpoint.replace(/\/+$/, "");
    const res = await fetch(`${base}/admin/address?limit=1`, { headers: { "x-admin-auth": provider.password } });
    if (!res.ok) throw new Error(`cf admin auth check HTTP ${res.status}`);
    return { domain: provider.domain };
  }
  return phpApi(provider, "external_status");
}

// canonical cf：GET /admin/address 全量列地址（分页拉完），不再只靠面板本地记账。
async function cfAdminList(provider: TempProvider): Promise<CfAlias[]> {
  const base = provider.endpoint.replace(/\/+$/, "");
  const out: CfAlias[] = [];
  const seen = new Set<string>();
  const limit = 100;
  for (let page = 0, offset = 0; page < 100; page++, offset += limit) {
    const res = await fetch(`${base}/admin/address?limit=${limit}&offset=${offset}`, {
      headers: { "x-admin-auth": provider.password }
    });
    if (!res.ok) throw new Error(`cf admin/address HTTP ${res.status}`);
    const text = await res.text();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* */ }
    const results: any[] = Array.isArray(j?.results) ? j.results : [];
    for (const r of results) {
      const address = String(r.address || r.name || "");
      if (!address) continue;
      // 只列与本源域名一致的地址：服务器地址库可能残留旧/其它域名条目（如换域名前的 wahah.xyz），按 provider.domain 过滤掉
      if (provider.domain && (address.split("@")[1] || "").toLowerCase() !== provider.domain.toLowerCase()) continue;
      if (seen.has(address)) continue; // 按完整地址去重
      seen.add(address);
      // local = 服务器认的地址名（new_address 的 name）；缺则取地址本地部分
      out.push({ address, local: String(r.name ?? localOf(address)), createdAt: r.created_at ?? null });
    }
    if (results.length < limit) break;
  }
  return out;
}

// 别名列表缓存：canonical /admin/address 全量返回，edu 这类实例 297 条要 ~30s，
// 每次开页面都打一次会直接把首屏拖死。这里做 stale-while-revalidate：
// 有缓存立刻返回旧数据并在后台刷新；没缓存才等上游。
const CF_ALIAS_TTL_MS = 10 * 60 * 1000;
const cfAliasCache = new Map<string, { items: CfAlias[]; at: number; refreshing: boolean }>();

// 缓存要落库：HF 容器空闲会休眠重启，纯内存缓存等于没有。
const CF_ALIAS_STORE_KEY = (id: string) => `cf.aliasCache.${id}`;

function readCfAliasStore(id: string): { items: CfAlias[]; at: number } | null {
  try {
    const raw = getSetting(CF_ALIAS_STORE_KEY(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { items?: CfAlias[]; at?: number };
    if (!Array.isArray(parsed.items) || !parsed.at) return null;
    return { items: parsed.items, at: parsed.at };
  } catch {
    return null;
  }
}

function writeCfAliasStore(id: string, items: CfAlias[]): void {
  try {
    setSetting(CF_ALIAS_STORE_KEY(id), JSON.stringify({ items, at: Date.now() }));
  } catch { /* 存不下不影响读 */ }
}

function putCfAliasCache(providerId: string, items: CfAlias[], at: number): void {
  cfAliasCache.set(providerId, { items, at, refreshing: false });
  writeCfAliasStore(providerId, items);
}

function refreshCfAliasCache(provider: TempProvider): void {
  const cur = cfAliasCache.get(provider.id);
  if (cur?.refreshing) return;
  if (cur) cur.refreshing = true;
  cfAdminList(provider)
    .then((items) => putCfAliasCache(provider.id, items, Date.now()))
    .catch(() => {
      const c = cfAliasCache.get(provider.id);
      if (c) c.refreshing = false;
    });
}

/** 写操作后让缓存失效，下次读会重新拉。 */
export function invalidateCfAliasCache(providerId?: string): void {
  if (providerId) {
    cfAliasCache.delete(providerId);
    try { setSetting(CF_ALIAS_STORE_KEY(providerId), ""); } catch { /* ignore */ }
  } else {
    cfAliasCache.clear();
  }
}

async function cfAdminListCached(provider: TempProvider): Promise<CfAlias[]> {
  let hit = cfAliasCache.get(provider.id);
  if (!hit) {
    // 冷启动先看落库的副本 —— 重启后也不至于让首屏再等 30 秒
    const stored = readCfAliasStore(provider.id);
    if (stored) {
      hit = { items: stored.items, at: stored.at, refreshing: false };
      cfAliasCache.set(provider.id, hit);
    }
  }
  if (hit) {
    if (Date.now() - hit.at > CF_ALIAS_TTL_MS) refreshCfAliasCache(provider);
    return hit.items; // 立即返回，不等后台刷新
  }
  const items = await cfAdminList(provider);
  putCfAliasCache(provider.id, items, Date.now());
  return items;
}

/**
 * 代面板转发 iCloud 引擎的登录（HME 别名管理需要 Web 会话，过期就要重新登录）。
 * 引擎侧：POST /api/accounts/:id/login { password, otpCode? }。
 * 密码/OTP 只在本进程内存里中转，不落库、不写日志。
 */
export async function icloudEngineLogin(
  provider: TempProvider,
  password: string,
  otpCode?: string
): Promise<unknown> {
  const accountId = await icloudAccountId(provider);
  // 引擎侧结构体标签是 json:"otp_code"（下划线）；传 otpCode 会被忽略，表现为"需要提供 OTP 验证码"
  return icloudApi<unknown>(provider, "POST", `/api/accounts/${encodeURIComponent(accountId)}/login`, {
    password,
    otp_code: otpCode || undefined
  });
}

export async function cfListAliases(provider: TempProvider): Promise<CfAlias[]> {
  if (provider.type === "icloud") {
    const accountId = await icloudAccountId(provider);
    const data = await icloudApi<{
      aliases: Array<{ email: string; anonymousId: string; label?: string; active?: boolean; createdAt?: string }> | null;
    }>(provider, "GET", `/api/aliases?account_id=${encodeURIComponent(accountId)}`);
    return (data?.aliases || []).map((a) => ({
      address: a.email,
      local: (a.email || "").split("@")[0],
      createdAt: a.createdAt ?? null,
      // 引擎 active=HME 别名的转发开关(激活=转发到账号 iCloud 收件箱)
      forwardEnabled: a.active === true,
      forwardTo: a.active === true ? ["iCloud 收件箱"] : [],
      id: a.anonymousId
    }));
  }
  if (provider.type === "cf") {
    // canonical /admin/address 是权威源，全量列；不可用才退回面板本地记账。
    // 走缓存：命中立刻返回（旧数据也行），过期由后台异步刷新。
    const cached = cfAliasCache.get(provider.id);
    try {
      return await cfAdminListCached(provider);
    } catch {
      if (cached) return cached.items; // 上游挂了也别让页面空掉
      return cfNames(provider).map((n) => ({ address: fullAddr(provider, n), local: n, createdAt: null }));
    }
  }
  const data = await phpApi<{ aliases?: CfAlias[] }>(provider, "external_aliases");
  return data.aliases ?? [];
}

// 面板直连 IMAP 的账户绑定校验：把 provider.accountId 换成引擎里的邮箱地址，
// 与面板凭据身份比对，不一致就不兜底（否则两个账号同 UID 会串正文）。
const icloudAccountEmailCache = new Map<string, { email: string; at: number }>();
async function icloudAccountEmail(provider: TempProvider): Promise<string | null> {
  const id = provider.accountId;
  if (!id) return null;
  const hit = icloudAccountEmailCache.get(provider.id);
  if (hit && Date.now() - hit.at < 60_000) return hit.email;
  try {
    const raw = await icloudApi<any>(provider, "GET", "/api/accounts");
    const list: any[] = Array.isArray(raw) ? raw : (raw?.accounts ?? raw?.data?.accounts ?? raw?.data ?? []);
    const acc = (Array.isArray(list) ? list : []).find((a) => String(a?.id ?? "") === String(id));
    const email: string | null = acc?.icloud_email ?? acc?.email ?? null;
    if (email) {
      icloudAccountEmailCache.set(provider.id, { email, at: Date.now() });
      return email;
    }
  } catch { /* 拿不到身份就退化为不做绑定校验 */ }
  return null;
}

// ---------- iCloud 收件箱摘要缓存：只给「读单封」用，列表/轮询永远走实时 ----------
// 摘要是引擎刚给的事实（UID 在同一信箱里不复用），短 TTL 只是防内存无限涨。
const ICLOUD_SUMMARY_TTL_MS = 2 * 60 * 1000;
const ICLOUD_SUMMARY_MAX = 500;
const icloudSummaries = new Map<string, Map<number, { s: CfMessageSummary; at: number }>>();

function rememberIcloudSummaries(providerId: string, list: CfMessageSummary[]): void {
  let byUid = icloudSummaries.get(providerId);
  if (!byUid) icloudSummaries.set(providerId, (byUid = new Map()));
  const now = Date.now();
  for (const s of list) {
    if (!s.uid) continue;
    byUid.delete(s.uid); // 重新插入 = 移到最新，便于按插入序淘汰
    byUid.set(s.uid, { s, at: now });
  }
  while (byUid.size > ICLOUD_SUMMARY_MAX) {
    const oldest = byUid.keys().next().value;
    if (oldest === undefined) break;
    byUid.delete(oldest);
  }
}

/** 命中条件与引擎按 alias 过滤等价：指定了 alias 时，收件人必须包含它。 */
function recalledIcloudSummary(providerId: string, alias: string, uid: number): CfMessageSummary | null {
  const hit = icloudSummaries.get(providerId)?.get(Number(uid));
  if (!hit || Date.now() - hit.at > ICLOUD_SUMMARY_TTL_MS) return null;
  const want = (alias || "").trim().toLowerCase();
  if (want && !(hit.s.to ?? "").toLowerCase().includes(want)) return null;
  return hit.s;
}

export async function cfInbox(provider: TempProvider, alias: string): Promise<CfMessageSummary[]> {
  if (provider.type === "icloud") {
    const accountId = await icloudAccountId(provider);
    // alias 空/缺省 = 整个收件箱（引擎 ListInbox limit/days）；非空才按收件人过滤
    const aliasParam = alias ? `&alias=${encodeURIComponent(alias)}` : "";
    const data = await icloudApi<{
      messages: Array<{ id: any; from?: string; to?: string; subject?: string; date?: string; preview?: string; body_html?: string }> | null;
    }>(provider, "GET", `/api/inbox?account_id=${encodeURIComponent(accountId)}${aliasParam}&limit=50`);
    const list = (data?.messages || []).map((m) => ({
      uid: Number(m.id) || 0,
      subject: m.subject ?? null,
      from: m.from ?? null,
      to: m.to ?? null,
      date: m.date ?? null,
      preview: m.preview ?? null,
      bodyHtml: m.body_html ?? null,
      messageId: String(m.id)
    }));
    rememberIcloudSummaries(provider.id, list);
    return list;
  }
  if (provider.type === "cf") {
    const local = localOf(alias);
    if (!local) return []; // cf 无「整个收件箱」概念（每址独立 jwt），空别名给空列表，避免 mint 出 ""@domain 垃圾地址
    cfAddName(provider, local); // 看过即记账，方便列表
    const mails = await cfReadParsed(provider, local);
    return mails.map((m) => cfMap(m, alias));
  }
  const data = await phpApi<{ messages?: CfMessageSummary[] }>(provider, "external_inbox", { query: { alias } });
  return data.messages ?? [];
}

// 出口列表用：带全量正文(text+html)，对齐 canonical /api/parsed_mails（列表也给完整 parsed，而非 preview 截断）。
// cf：一次 parsed_mails 全量本就含正文，零额外往返；php：摘要切片后逐封补全量。
export async function cfInboxRich(provider: TempProvider, alias: string, limit: number, offset: number): Promise<CfMessageDetail[]> {
  if (provider.type === "icloud") {
    // 引擎只给被洗过的 preview（multipart 时常为空）。只有「两个正文都空」才兜底 ——
    // 否则纯文本邮件（本来就没 HTML）每次读列表都要白连一次 IMAP。
    // 正文一律以面板直连结果优先，和 cfMessage 保持同一优先级。
    const summaries = (await cfInbox(provider, alias)).slice(offset, offset + limit);
    const blank = (v: string | null | undefined) => !(v ?? "").trim();
    const need = summaries.filter((s) => blank(s.preview) && blank(s.bodyHtml)).map((s) => Number(s.uid));
    const fetched =
      need.length > 0
        ? await fetchIcloudBodies(need, { expectedEmail: await icloudAccountEmail(provider) })
        : null;
    return summaries.map((s) => {
      const b = fetched?.bodies.get(Number(s.uid));
      return { ...s, bodyText: b?.text ?? s.preview ?? null, bodyHtml: b?.html ?? s.bodyHtml ?? null };
    });
  }
  if (provider.type === "cf") {
    const mails = await cfReadParsed(provider, localOf(alias));
    return mails.slice(offset, offset + limit).map((m) => {
      const html: string | null = m.html ?? null;
      const body: string = m.text ?? "";
      return { ...cfMap(m, alias), bodyText: body || null, bodyHtml: html };
    });
  }
  const summaries = (await cfInbox(provider, alias)).slice(offset, offset + limit);
  const out: CfMessageDetail[] = [];
  for (const s of summaries) {
    try { out.push(await cfMessage(provider, alias, s.uid)); }
    catch { out.push({ ...s, bodyText: s.preview ?? null, bodyHtml: null }); }
  }
  return out;
}

export async function cfSent(provider: TempProvider, alias: string): Promise<CfMessageSummary[]> {
  if (provider.type === "icloud") return []; // icloud-hme 只收不发，无已发
  if (provider.type === "cf") return []; // cf 壳无已发
  const data = await phpApi<{ messages?: CfMessageSummary[] }>(provider, "external_sent", { query: { alias } });
  return data.messages ?? [];
}

export async function cfSearch(
  provider: TempProvider,
  alias: string,
  query: { keyword?: string; from?: string; subject?: string; limit?: number }
): Promise<CfMessageSummary[]> {
  const messages = await cfInbox(provider, alias);
  const kw = query.keyword?.trim().toLowerCase();
  const fromQ = query.from?.trim().toLowerCase();
  const subjQ = query.subject?.trim().toLowerCase();
  return messages.filter((m) => {
    if (kw) { const hay = `${m.subject ?? ""}\n${m.from ?? ""}\n${m.preview ?? ""}`.toLowerCase(); if (!hay.includes(kw)) return false; }
    if (fromQ && !(m.from ?? "").toLowerCase().includes(fromQ)) return false;
    if (subjQ && !(m.subject ?? "").toLowerCase().includes(subjQ)) return false;
    return true;
  }).slice(0, query.limit ?? 50);
}

export async function cfMessage(provider: TempProvider, alias: string, uid: number): Promise<CfMessageDetail> {
  if (provider.type === "icloud") {
    // icloud-hme 无单封详情口，只能拉 inbox 找 uid（2~7s）。刚列过的信先查摘要缓存，命中就省掉这一趟；
    // 正文缺失时用面板直连 IMAP 取原始报文解析
    const s =
      recalledIcloudSummary(provider.id, alias, uid) ??
      (await cfInbox(provider, alias)).find((x) => Number(x.uid) === Number(uid));
    if (!s) throw new Error("iCloud HME 未找到该邮件");
    let bodyText = s.preview ?? null;
    let bodyHtml = s.bodyHtml ?? null;
    if (!(bodyText ?? "").trim() && !(bodyHtml ?? "").trim()) {
      const b = await fetchIcloudBody(Number(uid), { expectedEmail: await icloudAccountEmail(provider) });
      if (b) {
        bodyText = b.text ?? bodyText;
        bodyHtml = b.html ?? bodyHtml;
      }
    }
    return { ...s, bodyText, bodyHtml, recipientHint: alias };
  }
  if (provider.type === "cf") {
    const mails = await cfReadParsed(provider, localOf(alias), 100);
    const m = mails.find((x) => Number(x.id) === Number(uid)) ?? {};
    const body: string = m.text ?? "";
    const html: string | null = m.html ?? null;
    return { ...cfMap(m, alias), bodyText: body || null, bodyHtml: html };
  }
  const data = await phpApi<{ message: CfMessageDetail }>(provider, "external_message", { query: { alias, uid } });
  return data.message;
}

export async function cfCreateAlias(provider: TempProvider, local: string): Promise<CfAlias> {
  if (provider.type === "icloud") {
    const accountId = await icloudAccountId(provider);
    const data = await icloudApi<{ email: string; label: string; created_at: string; account_id: string }>(
      provider,
      "POST",
      "/api/create",
      { account_id: accountId, label: local }
    );
    // create 返回无 anonymousId（删除时再按 email 反查），故 id 留空
    return {
      address: data.email,
      local: (data.email || "").split("@")[0],
      createdAt: data.created_at,
      id: undefined,
      // HME 新建别名默认激活(转发到账号 iCloud 收件箱)
      forwardEnabled: true,
      forwardTo: ["iCloud 收件箱"]
    };
  }
  if (provider.type === "cf") {
    const r = await cfMint(provider, local);
    cfAddName(provider, localOf(r.address));
    return { address: r.address, local: localOf(r.address), createdAt: null, id: r.addressId };
  }
  const data = await phpApi<{ alias?: CfAlias } & Partial<CfAlias>>(provider, "external_create_alias", { method: "POST", body: { local } });
  return data.alias ?? (data as CfAlias);
}

export async function cfDeleteAlias(provider: TempProvider, local: string): Promise<void> {
  if (provider.type === "icloud") {
    // create 不回 anonymousId，删除前先按 email/local 在 /api/aliases 反查
    const accountId = await icloudAccountId(provider);
    const data = await icloudApi<{ aliases: Array<{ email: string; anonymousId: string }> | null }>(
      provider,
      "GET",
      `/api/aliases?account_id=${encodeURIComponent(accountId)}`
    );
    const target = localOf(local);
    const row = (data?.aliases || []).find((a) => a.email === local || localOf(a.email) === target);
    if (!row) throw new Error("iCloud HME 未找到该别名");
    await icloudApi(provider, "DELETE", `/api/aliases/${encodeURIComponent(row.anonymousId)}`, { account_id: accountId });
    return;
  }
  if (provider.type === "cf") {
    // canonical 删除：先按 local 在 /admin/address 反查数字 id，再 DELETE /admin/delete_address/:id。
    // （edu/roastalpha 的 cf.php shim 2026-06-27 已补齐此 canonical 端点；之前 cf 壳无删除口、只能清本地记账。）
    const base = provider.endpoint.replace(/\/+$/, "");
    const target = localOf(local);
    let addrId: number | null = null;
    try {
      const res = await fetch(`${base}/admin/address?limit=1000&offset=0`, { headers: { "x-admin-auth": provider.password } });
      if (res.ok) {
        const j: any = await res.json().catch(() => null);
        const results: any[] = Array.isArray(j?.results) ? j.results : [];
        const row = results.find((r) => localOf(String(r.address || r.name || "")) === target || String(r.name) === target);
        if (row && row.id != null) addrId = Number(row.id);
      }
    } catch { /* 列表失败则跳过远端删除，至少清本地记账 */ }
    if (addrId != null) {
      const del = await fetch(`${base}/admin/delete_address/${addrId}`, {
        method: "DELETE",
        headers: { "x-admin-auth": provider.password }
      });
      if (!del.ok) throw new Error(`cf delete_address HTTP ${del.status}`);
    }
    cfRemoveName(provider, target); // 同步清面板本地记账
    return;
  }
  await phpApi(provider, "external_delete_alias", { method: "POST", body: { local } });
}

export async function cfSend(provider: TempProvider, input: CfSendInput): Promise<any> {
  if (provider.type === "icloud") {
    // 引擎 SMTP 腿(App 专用密码,直连优先/代理回落):from 可用账号主地址或邮件别名
    const accountId = await icloudAccountId(provider);
    await icloudApi(provider, "POST", "/api/send", {
      account_id: accountId,
      from: input.from,
      to: input.to,
      cc: [],
      bcc: [],
      subject: input.subject ?? "",
      body: input.body ?? "",
      html: Boolean(input.html)
    });
    return { status: "ok" };
  }
  if (provider.type === "cf") {
    // canonical cf 管理员发信：POST /admin/send_mail (x-admin-auth)，字段 {from_mail,to_mail,subject,content,is_html} → {status:"ok"}
    const res = await fetch(provider.endpoint.replace(/\/+$/, "") + "/admin/send_mail", {
      method: "POST",
      headers: { "x-admin-auth": provider.password, "content-type": "application/json" },
      body: JSON.stringify({
        from_mail: input.from,
        to_mail: input.to.join(","),
        subject: input.subject ?? "",
        content: input.body ?? "",
        is_html: Boolean(input.html)
      })
    });
    const text = await res.text();
    let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
    if (!res.ok) throw new Error(j?.error || j?.message || `cf send_mail HTTP ${res.status}`);
    return j ?? { status: "ok" };
  }
  return phpApi(provider, "external_send", {
    method: "POST",
    body: { from: input.from, to: input.to, subject: input.subject ?? "", body: input.body ?? "", format: input.html ? "html" : "text" }
  });
}

export async function cfGlobalForwarding(provider: TempProvider): Promise<CfForwarding> {
  if (provider.type === "icloud") return { enabled: false, forwardTo: [] };
  if (provider.type === "cf") return { enabled: false, forwardTo: [] };
  const data = await phpApi<{ forwarding: CfForwarding }>(provider, "external_global_forwarding");
  return data.forwarding;
}

export async function cfUpdateAliasForwarding(provider: TempProvider, address: string, enabled: boolean, forwardTo: string[]): Promise<CfAlias[]> {
  if (provider.type === "icloud") throw new Error("iCloud HME 不支持转发设置");
  if (provider.type === "cf") throw new Error("cloudflare_temp_email 壳不支持转发设置");
  const data = await phpApi<{ aliases?: CfAlias[] }>(provider, "external_update_forwarding", {
    form: { address, enabled: enabled ? 1 : 0, forwardTo: forwardTo.join(",") }
  });
  return data.aliases ?? [];
}

export async function cfUpdateGlobalForwarding(provider: TempProvider, enabled: boolean, forwardTo: string[]): Promise<CfForwarding> {
  if (provider.type === "icloud") throw new Error("iCloud HME 不支持转发设置");
  if (provider.type === "cf") throw new Error("cloudflare_temp_email 壳不支持转发设置");
  const data = await phpApi<{ forwarding: CfForwarding }>(provider, "external_update_global_forwarding", {
    form: { enabled: enabled ? 1 : 0, forwardTo: forwardTo.join(",") }
  });
  return data.forwarding;
}
