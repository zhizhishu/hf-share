// /api/cf/* —— 临时邮箱（多 provider）。
// 邮件类操作按 ?provider=<id> 解析具体源（默认主源）；另有 /api/cf/providers 增删改查。
// 旧的 /api/cf/config 仍在，作用于「主 provider」（向后兼容现有 edu 的连接表单）。
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { invalidateCfAliasCache, icloudEngineLogin } from "../cf-mail";
import { fetchIcloudBodies, icloudImapConfig } from "../icloud-imap";
import { clearCfConfig, getCfConfigStatus, saveCfConfig } from "../runtime-config";
import {
  addProvider,
  getProvider,
  listProvidersPublic,
  removeProvider,
  updateProvider,
  type TempProvider,
  type TempProviderPublic
} from "../temp-providers";
import {
  cfCreateAlias,
  cfDeleteAlias,
  cfDomain,
  cfGlobalForwarding,
  cfInbox,
  cfListAliases,
  cfMessage,
  cfSend,
  cfSent,
  cfStatus,
  cfUpdateAliasForwarding,
  cfUpdateGlobalForwarding
} from "../cf-mail";

const aliasQuery = z.object({ alias: z.string().min(1), provider: z.string().optional() });
// inbox 专用：alias 可空/缺省 = 整个收件箱（icloud 引擎 ListInbox）；sent 等仍须具体别名
const inboxQuery = z.object({ alias: z.string().optional(), provider: z.string().optional() });
const messageQuery = z.object({ alias: z.string().min(1), uid: z.coerce.number().int(), provider: z.string().optional() });
const providerQuery = z.object({ provider: z.string().optional() });
const createAliasSchema = z.object({ local: z.string().min(1).max(64), provider: z.string().optional() });
const sendSchema = z.object({
  // iCloud 源可留空(引擎默认账号主地址);CF/php 源由 UI 填选中别名
  from: z.string().default(""),
  to: z.array(z.string().email()).min(1),
  subject: z.string().optional(),
  body: z.string().optional(),
  html: z.boolean().optional(),
  provider: z.string().optional()
});
const aliasForwardingSchema = z.object({
  address: z.string().min(1),
  enabled: z.boolean(),
  forwardTo: z.array(z.string().email()).max(5),
  provider: z.string().optional()
});
const globalForwardingSchema = z.object({
  enabled: z.boolean(),
  forwardTo: z.array(z.string().email()).max(5),
  provider: z.string().optional()
});
const configSchema = z.object({
  endpoint: z.string().url(),
  domain: z.string().optional().nullable(),
  password: z.string().optional().nullable()
});
const addProviderSchema = z.object({
  name: z.string().min(1).max(40),
  type: z.enum(["php", "cf", "icloud"]).optional(),
  endpoint: z.string().url(),
  domain: z.string().optional(),
  password: z.string().min(1),
  accountId: z.string().optional()
});
const patchProviderSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  type: z.enum(["php", "cf", "icloud"]).optional(),
  endpoint: z.string().url().optional(),
  domain: z.string().optional(),
  password: z.string().optional(),
  accountId: z.string().optional()
});

function toPublic(p: TempProvider): TempProviderPublic {
  const { password, ...rest } = p;
  return { ...rest, hasPassword: Boolean(password) };
}

// 按 ?provider= 解析具体源；缺省用主源。找不到返回 undefined。
function resolve(request: FastifyRequest): TempProvider | undefined {
  const id = (request.query as { provider?: string } | undefined)?.provider;
  return getProvider(id);
}

export async function cfMailRoutes(app: FastifyInstance): Promise<void> {
  // ---- provider 注册表（多源）----
  app.get("/api/cf/providers", async () => {
    return { items: listProvidersPublic() };
  });

  app.post("/api/cf/providers", async (request) => {
    const body = addProviderSchema.parse(request.body);
    return toPublic(addProvider(body));
  });

  app.patch("/api/cf/providers/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = patchProviderSchema.parse(request.body);
    const updated = updateProvider(id, body);
    if (!updated) return reply.code(404).send({ error: "provider not found" });
    return toPublic(updated);
  });

  app.delete("/api/cf/providers/:id", async (request) => {
    const { id } = request.params as { id: string };
    return { success: removeProvider(id) };
  });

  // ---- 旧的「主源」连接表单（向后兼容）----
  app.get("/api/cf/config", async () => getCfConfigStatus());
  app.post("/api/cf/config", async (request) => {
    const body = configSchema.parse(request.body);
    saveCfConfig({ endpoint: body.endpoint, domain: body.domain, password: body.password });
    return getCfConfigStatus();
  });
  app.delete("/api/cf/config", async () => {
    clearCfConfig();
    return { success: true };
  });

  // ---- 邮件类操作（按 provider）----
  app.get("/api/cf/status", async (request) => {
    const query = providerQuery.parse(request.query);
    const provider = getProvider(query.provider);
    if (!provider) return { configured: false, domain: null };
    try {
      const status = await cfStatus(provider);
      return { configured: true, provider: provider.id, domain: cfDomain(provider) || status?.domain || null, status };
    } catch (error) {
      return { configured: true, provider: provider.id, domain: cfDomain(provider) || null, error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get("/api/cf/aliases", async (request, reply) => {
    const provider = resolve(request);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    return { items: await cfListAliases(provider) };
  });

  app.post("/api/cf/aliases", async (request, reply) => {
    const body = createAliasSchema.parse(request.body);
    const provider = getProvider(body.provider);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    const created = await cfCreateAlias(provider, body.local.trim().toLowerCase());
    invalidateCfAliasCache(provider.id);
    return created;
  });

  app.delete("/api/cf/aliases/:local", async (request, reply) => {
    const provider = resolve(request);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    const { local } = request.params as { local: string };
    await cfDeleteAlias(provider, local);
    invalidateCfAliasCache(provider.id);
    return { success: true };
  });

  // iCloud 直连 IMAP 自检：把运行环境里看到的东西如实吐出来（不含任何凭据明文）。
  // iCloud 引擎登录代理：HME 别名管理走 Web 会话，会话过期(ENGINE_UPSTREAM_UNAUTHORIZED)时用。
  // 密码与 OTP 只在内存中转，不落库、不回显。
  app.post("/api/cf/icloud-login", async (request, reply) => {
    const body = (request.body ?? {}) as { provider?: string; password?: string; otpCode?: string };
    const provider = getProvider(body.provider ?? "");
    if (!provider || provider.type !== "icloud") {
      return reply.code(400).send({ error: "provider is not an icloud source" });
    }
    const password = (body.password ?? "").trim() || (process.env.APPLE_ID_PASSWORD ?? "").trim();
    if (!password) return reply.code(400).send({ error: "password required (body.password or APPLE_ID_PASSWORD)" });
    try {
      const r = await icloudEngineLogin(provider, password, body.otpCode?.trim());
      invalidateCfAliasCache(provider.id);
      return { success: true, result: r };
    } catch (e) {
      return reply.code(400).send({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/cf/icloud-imap-selftest", async (request, reply) => {
    const q = request.query as { uid?: string; provider?: string };
    const uid = Number(q.uid ?? 0);
    const config = icloudImapConfig();
    if (!uid) return { config, note: "传 ?uid=<数字> 才会真连一次 IMAP" };
    const provider = q.provider ? getProvider(q.provider) : undefined;
    const r = await fetchIcloudBodies([uid], { expectedEmail: null });
    const body = r.bodies.get(uid);
    return {
      config,
      provider: provider ? { id: provider.id, type: provider.type, accountId: provider.accountId ?? null } : null,
      status: r.status,
      reason: r.reason ?? null,
      fetched: r.bodies.size,
      textLen: body?.text?.length ?? 0,
      htmlLen: body?.html?.length ?? 0,
      failed: Object.fromEntries(r.failed)
    };
  });

  app.get("/api/cf/inbox", async (request, reply) => {
    const query = inboxQuery.parse(request.query);
    const provider = getProvider(query.provider);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    return { items: await cfInbox(provider, query.alias ?? "") };
  });

  app.get("/api/cf/sent", async (request, reply) => {
    const query = aliasQuery.parse(request.query);
    const provider = getProvider(query.provider);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    return { items: await cfSent(provider, query.alias) };
  });

  app.get("/api/cf/message", async (request, reply) => {
    const query = messageQuery.parse(request.query);
    const provider = getProvider(query.provider);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    return cfMessage(provider, query.alias, query.uid);
  });

  app.post("/api/cf/send", async (request, reply) => {
    const body = sendSchema.parse(request.body);
    const provider = getProvider(body.provider);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    return cfSend(provider, body);
  });

  app.get("/api/cf/forwarding/global", async (request, reply) => {
    const provider = resolve(request);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    return cfGlobalForwarding(provider);
  });

  app.post("/api/cf/forwarding/alias", async (request, reply) => {
    const body = aliasForwardingSchema.parse(request.body);
    const provider = getProvider(body.provider);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    const aliases = await cfUpdateAliasForwarding(provider, body.address, body.enabled, body.forwardTo);
    return { items: aliases };
  });

  app.post("/api/cf/forwarding/global", async (request, reply) => {
    const body = globalForwardingSchema.parse(request.body);
    const provider = getProvider(body.provider);
    if (!provider) return reply.code(400).send({ error: "temp-mail provider is not configured" });
    return cfUpdateGlobalForwarding(provider, body.enabled, body.forwardTo);
  });
}
