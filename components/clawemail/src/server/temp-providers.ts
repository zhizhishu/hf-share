// 临时邮箱「多 provider 注册表」。
// 把原来写死的单实例（edu）升级成可在 UI 里添加多个临时邮箱源。
// 每个 provider 有类型：
//   - "php": 自建 PHP 临时邮箱（webhostmost / edu.002836.xyz 那套，X-Admin-Password）
//   - "cf" : cloudflare_temp_email（不同 API，admin x-admin-auth + address JWT）
// 数据存 app_settings 的 cf.providers(JSON)，随 Supabase 持久化；password 仅服务端。
import { getSetting, setSetting } from "./db";
import { config } from "./config";

export type TempProviderType = "php" | "cf" | "icloud";

export type TempProvider = {
  id: string;
  name: string;
  type: TempProviderType;
  endpoint: string; // php: api.php 地址；cf: 实例 base url；icloud: icloud-hme 服务 base url
  domain: string;
  password: string; // php: 管理员密码；cf: 管理员 auth(x-admin-auth)；icloud: Basic Auth 密码(user 固定 claw)
  accountId?: string; // icloud: 多账号时指定 account_id；其它类型不用
};

export type TempProviderPublic = Omit<TempProvider, "password"> & { hasPassword: boolean };

const KEY = "cf.providers";

// 收敛 provider.type 到三个合法值；未知一律退回 php（别把 cf/icloud 压成 php）
function asType(x: any): TempProviderType {
  return x === "cf" || x === "icloud" ? x : "php";
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "temp";
}

// 旧的单实例配置（cf.endpoint/domain/password 或 env）迁移成一个默认 php provider，
// 保证升级后 edu 立刻还在、不丢。
function legacyProvider(): TempProvider | null {
  const endpoint =
    getSetting("cf.endpoint") ??
    config.CF_TEMP_EMAIL_API_ENDPOINT ??
    (config.CF_TEMP_EMAIL_BASE_URL ? `${config.CF_TEMP_EMAIL_BASE_URL.replace(/\/+$/, "")}/api.php` : undefined);
  const password = getSetting("cf.password") ?? config.CF_TEMP_EMAIL_ADMIN_PASSWORD;
  const domain = getSetting("cf.domain") ?? config.CF_TEMP_EMAIL_DOMAIN ?? "";
  if (!endpoint || !password) return null;
  return { id: "edu", name: domain || "edu", type: "php", endpoint, domain, password };
}

export function listProviders(): TempProvider[] {
  const raw = getSetting(KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((p) => p && p.id && p.endpoint).map(normalize);
    } catch {
      /* fall through to legacy */
    }
  }
  const legacy = legacyProvider();
  return legacy ? [legacy] : [];
}

function normalize(p: any): TempProvider {
  return {
    id: String(p.id),
    name: String(p.name || p.domain || p.id),
    type: asType(p.type),
    endpoint: String(p.endpoint || "").replace(/\/+$/, ""),
    domain: String(p.domain || ""),
    password: String(p.password || ""),
    ...(p.accountId ? { accountId: String(p.accountId) } : {})
  };
}

export function getProvider(id?: string): TempProvider | undefined {
  const list = listProviders();
  if (!id) return list[0];
  return list.find((p) => p.id === id);
}

export function requireProvider(id?: string): TempProvider {
  const p = getProvider(id);
  if (!p) throw new Error(id ? `临时邮箱源 ${id} 不存在` : "尚未配置任何临时邮箱源");
  return p;
}

export function listProvidersPublic(): TempProviderPublic[] {
  return listProviders().map(({ password, ...rest }) => ({ ...rest, hasPassword: Boolean(password) }));
}

function persist(list: TempProvider[]): void {
  setSetting(KEY, JSON.stringify(list));
}

export function addProvider(input: {
  name: string;
  type?: TempProviderType;
  endpoint: string;
  domain?: string;
  password: string;
  accountId?: string;
}): TempProvider {
  const list = listProviders();
  let id = slug(input.name || input.domain || "temp");
  let n = 1;
  while (list.some((p) => p.id === id)) id = `${slug(input.name || "temp")}-${++n}`;
  const provider: TempProvider = {
    id,
    name: input.name?.trim() || input.domain || id,
    type: asType(input.type),
    endpoint: input.endpoint.trim().replace(/\/+$/, ""),
    domain: (input.domain ?? "").trim(),
    password: input.password,
    ...(input.accountId?.trim() ? { accountId: input.accountId.trim() } : {})
  };
  persist([...list, provider]);
  return provider;
}

export function updateProvider(
  id: string,
  patch: Partial<Pick<TempProvider, "name" | "type" | "endpoint" | "domain" | "password" | "accountId">>
): TempProvider | undefined {
  const list = listProviders();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  const cur = list[idx];
  const next: TempProvider = {
    ...cur,
    name: patch.name?.trim() || cur.name,
    type: patch.type ?? cur.type,
    endpoint: (patch.endpoint ?? cur.endpoint).trim().replace(/\/+$/, ""),
    domain: patch.domain !== undefined ? patch.domain.trim() : cur.domain,
    // 只有传入非空才覆盖密码，方便改 endpoint/domain 时不必重输
    password: patch.password && patch.password.trim() ? patch.password : cur.password,
    // accountId：传入非空则覆盖，否则保留原值（透传持久化）
    ...(patch.accountId !== undefined
      ? patch.accountId.trim()
        ? { accountId: patch.accountId.trim() }
        : {}
      : cur.accountId
        ? { accountId: cur.accountId }
        : {})
  };
  list[idx] = next;
  persist(list);
  return next;
}

export function removeProvider(id: string): boolean {
  const list = listProviders();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  persist(next);
  return true;
}

export function tempConfigured(): boolean {
  return listProviders().length > 0;
}
