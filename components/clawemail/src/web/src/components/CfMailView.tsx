import { useEffect, useMemo, useState } from "react";
import { wrapEmailHtml } from "../email-html";
import { AliasPicker } from "./AliasPicker";
import {
  clearCfConfig,
  createCfAlias,
  deleteCfAlias,
  fetchCfAliases,
  fetchCfConfig,
  fetchCfGlobalForwarding,
  fetchCfInbox,
  fetchCfMessage,
  fetchCfProviders,
  fetchCfStatus,
  saveCfConfig,
  sendCfMail,
  updateCfAliasForwarding,
  updateCfGlobalForwarding,
  type CfAlias,
  type CfConfigStatus,
  type CfMessageDetail,
  type CfMessageSummary,
  type TempProviderPublic
} from "../api";
import { useResizableWidth } from "../hooks";
import { usePrefs } from "../i18n";
import { CodeReadout } from "./CodeReadout";
import { SearchBox } from "./SearchBox";

type Props = {
  onError: (msg: string) => void;
  onStatus: (msg: string) => void;
  focusAlias?: string;
  provider?: string;
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function CfMailView({ onError, onStatus, focusAlias, provider }: Props) {
  const { lang } = usePrefs();
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);

  const [providerId, setProviderId] = useState<string | undefined>(provider);
  const [providers, setProviders] = useState<TempProviderPublic[]>([]);

  const list = useResizableWidth({
    storageKey: "cf.listWidth",
    initial: 360,
    min: 260,
    max: 560
  });

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [domain, setDomain] = useState("");
  const [aliases, setAliases] = useState<CfAlias[]>([]);
  const [selectedAlias, setSelectedAlias] = useState("");
  const [messages, setMessages] = useState<CfMessageSummary[]>([]);
  const [selected, setSelected] = useState<CfMessageDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const searchItems = useMemo(
    () => messages.map((m) => ({ subject: m.subject, from: m.from, preview: m.preview })),
    [messages]
  );
  const [newLocal, setNewLocal] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);

  // ESC 关闭写邮件弹层
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  // iCloud 发信地址(引擎 SMTP 腿):可用账号主地址或邮件别名;记住上次用的
  const [fromAddr, setFromAddr] = useState(() => localStorage.getItem("clawemail:icloud:from") || "");

  const [fwdOpen, setFwdOpen] = useState(false);
  const [fwdBusy, setFwdBusy] = useState(false);
  const [aliasFwdEnabled, setAliasFwdEnabled] = useState(false);
  const [aliasFwdTo, setAliasFwdTo] = useState("");
  const [globalFwdEnabled, setGlobalFwdEnabled] = useState(false);
  const [globalFwdTo, setGlobalFwdTo] = useState("");

  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgStatus, setCfgStatus] = useState<CfConfigStatus | null>(null);
  const [cfgEndpoint, setCfgEndpoint] = useState("");
  const [cfgDomain, setCfgDomain] = useState("");
  const [cfgPassword, setCfgPassword] = useState("");

  function aliasAddress(local: string): string {
    const found = aliases.find((a) => a.local === local);
    if (found?.address) return found.address;
    return domain ? `${local}@${domain}` : local;
  }

  function loadConfig() {
    return fetchCfConfig()
      .then((c) => {
        setCfgStatus(c);
        setCfgEndpoint(c.endpoint);
        setCfgDomain(c.domain);
        setCfgPassword("");
        return c;
      })
      .catch(() => null);
  }

  useEffect(() => {
    setProviderId(provider);
  }, [provider]);

  useEffect(() => {
    fetchCfProviders().then(setProviders).catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedAlias("");
    setSelected(null);
    setAliases([]); // 切来源时清掉上一个来源的地址，免得计数/列表串台
    fetchCfStatus(providerId)
      .then((s) => {
        setConfigured(s.configured);
        setDomain(s.domain ?? "");
        if (s.error) onError(s.error);
      })
      .catch((e) => {
        setConfigured(false);
        onError(errMsg(e));
      });
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  async function handleSaveConfig() {
    const endpoint = cfgEndpoint.trim();
    if (!endpoint) return;
    if (!cfgStatus?.hasPassword && !cfgPassword.trim()) {
      onError(L("请填写管理员密码", "Admin password is required"));
      return;
    }
    setCfgBusy(true);
    try {
      const c = await saveCfConfig({
        endpoint,
        domain: cfgDomain.trim(),
        password: cfgPassword.trim() || undefined
      });
      setCfgStatus(c);
      setCfgPassword("");
      setCfgOpen(false);
      onStatus(L("已保存连接配置", "connection saved"));
      // re-probe provider + reload aliases now that creds may have changed
      const s = await fetchCfStatus();
      setConfigured(s.configured);
      setDomain(s.domain ?? "");
      if (s.configured) loadAliases(false);
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setCfgBusy(false);
    }
  }

  async function handleClearConfig() {
    if (!confirm(L("清除临时邮箱连接配置？", "Clear temp-mail connection config?"))) return;
    setCfgBusy(true);
    try {
      await clearCfConfig();
      onStatus(L("已清除连接配置", "connection cleared"));
      await loadConfig();
      const s = await fetchCfStatus();
      setConfigured(s.configured);
      setDomain(s.domain ?? "");
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setCfgBusy(false);
    }
  }

  async function loadAliases(autoSelect = true) {
    try {
      const items = await fetchCfAliases(providerId);
      setAliases(items);
      if (autoSelect && !selectedAlias && items.length) {
        setSelectedAlias(items[0].local);
      }
    } catch (e) {
      onError(errMsg(e));
    }
  }

  useEffect(() => {
    if (configured) {
      loadAliases();
      // icloud is receive-only — no forwarding endpoint to probe.
      const t = providers.find((p) => p.id === (providerId ?? providers[0]?.id))?.type;
      if (t !== "icloud") {
        fetchCfGlobalForwarding(providerId)
          .then((f) => {
            setGlobalFwdEnabled(!!f.enabled);
            setGlobalFwdTo((f.forwardTo ?? []).join(", "));
          })
          .catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, providerId, providers]);

  useEffect(() => {
    if (focusAlias) setSelectedAlias(focusAlias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAlias]);

  useEffect(() => {
    const found = aliases.find((a) => a.local === selectedAlias);
    setAliasFwdEnabled(!!found?.forwardEnabled);
    setAliasFwdTo((found?.forwardTo ?? []).join(", "));
  }, [selectedAlias, aliases]);

  function parseRecipients(raw: string): string[] {
    return raw
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function saveAliasForwarding() {
    if (!selectedAlias) return;
    setFwdBusy(true);
    try {
      const items = await updateCfAliasForwarding(
        aliasAddress(selectedAlias),
        aliasFwdEnabled,
        parseRecipients(aliasFwdTo),
        providerId
      );
      setAliases(items);
      onStatus(
        aliasFwdEnabled
          ? L(`已开启 ${selectedAlias} 转发`, `forwarding on for ${selectedAlias}`)
          : L(`已关闭 ${selectedAlias} 转发`, `forwarding off for ${selectedAlias}`)
      );
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setFwdBusy(false);
    }
  }

  async function saveGlobalForwarding() {
    setFwdBusy(true);
    try {
      const f = await updateCfGlobalForwarding(globalFwdEnabled, parseRecipients(globalFwdTo), providerId);
      setGlobalFwdEnabled(!!f.enabled);
      setGlobalFwdTo((f.forwardTo ?? []).join(", "));
      onStatus(
        f.enabled
          ? L("已开启全局转发", "global forwarding on")
          : L("已关闭全局转发", "global forwarding off")
      );
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setFwdBusy(false);
    }
  }

  async function loadInbox(alias = selectedAlias) {
    if (!alias) {
      setMessages([]);
      return;
    }
    setBusy(true);
    try {
      const items = await fetchCfInbox(alias, providerId);
      setMessages(items);
      setSelected(null);
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (selectedAlias) loadInbox(selectedAlias);
    else {
      setMessages([]);
      setSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAlias]);

  async function openMessage(uid: number) {
    try {
      setSelected(await fetchCfMessage(selectedAlias, uid, providerId));
    } catch (e) {
      onError(errMsg(e));
    }
  }

  async function handleCreate() {
    const local = newLocal.trim().toLowerCase();
    if (!local) return;
    try {
      const created = await createCfAlias(local, providerId);
      setNewLocal("");
      onStatus(L(`已创建 ${created.address ?? local}`, `created ${created.address ?? local}`));
      await loadAliases(false);
      setSelectedAlias(created.local ?? local);
    } catch (e) {
      onError(errMsg(e));
    }
  }

  async function handleDeleteAlias(local: string) {
    if (!confirm(L(`删除别名 ${local}？该地址将不可用`, `Delete alias ${local}?`))) return;
    try {
      await deleteCfAlias(local, providerId);
      onStatus(L(`已删除 ${local}`, `deleted ${local}`));
      if (selectedAlias === local) {
        setSelectedAlias("");
        setMessages([]);
        setSelected(null);
      }
      await loadAliases(false);
    } catch (e) {
      onError(errMsg(e));
    }
  }

  async function handleSend() {
    const toList = to
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (toList.length === 0) return;
    // iCloud:发件地址用独立输入(引擎 SMTP,可留空=账号主地址);其余源:选中别名
    if (!isIcloud && !selectedAlias) return;
    const from = isIcloud ? fromAddr.trim() : aliasAddress(selectedAlias);
    if (isIcloud) localStorage.setItem("clawemail:icloud:from", from);
    setSendBusy(true);
    try {
      await sendCfMail({
        from,
        to: toList,
        subject,
        body,
        html: false,
        provider: providerId
      });
      onStatus(L("已发送", "sent"));
      setComposeOpen(false);
      setTo("");
      setSubject("");
      setBody("");
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setSendBusy(false);
    }
  }

  // icloud (icloud-hme) is receive-only: hide compose / forwarding for it.
  const curType = providers.find((p) => p.id === (providerId ?? providers[0]?.id))?.type;
  const isIcloud = curType === "icloud";

  useEffect(() => {
    if (!composeOpen && !fwdOpen && !cfgOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (composeOpen) setComposeOpen(false);
      else if (fwdOpen) setFwdOpen(false);
      else if (cfgOpen) setCfgOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [composeOpen, fwdOpen, cfgOpen]);

  const configForm = (
    <div className="cf-config">
      <div className="cf-config-grid">
        <label>
          <span>{L("接口地址", "API endpoint")}</span>
          <input
            value={cfgEndpoint}
            onChange={(e) => setCfgEndpoint(e.target.value)}
            placeholder="https://edu.002836.xyz/api.php"
            spellCheck={false}
          />
        </label>
        <label>
          <span>{L("邮箱域名", "Mail domain")}</span>
          <input
            value={cfgDomain}
            onChange={(e) => setCfgDomain(e.target.value)}
            placeholder="edu.002836.xyz"
            spellCheck={false}
          />
        </label>
        <label>
          <span>{L("管理员密码", "Admin password")}</span>
          <input
            type="password"
            value={cfgPassword}
            onChange={(e) => setCfgPassword(e.target.value)}
            placeholder={
              cfgStatus?.hasPassword
                ? L("已设置（留空则不变）", "set — leave blank to keep")
                : L("必填", "required")
            }
            autoComplete="new-password"
            spellCheck={false}
          />
        </label>
      </div>
      <div className="cf-config-foot">
        <span className="cf-config-src">
          {cfgStatus?.source === "env"
            ? L("当前来自服务器环境变量", "currently from server env")
            : cfgStatus?.source === "ui"
              ? L("当前来自界面配置（已持久化）", "from UI config (persisted)")
              : L("尚未配置", "not configured yet")}
        </span>
        <span style={{ flex: 1 }} />
        {cfgStatus?.source === "ui" && (
          <button className="danger" onClick={handleClearConfig} disabled={cfgBusy}>
            {L("清除", "Clear")}
          </button>
        )}
        <button className="primary" onClick={handleSaveConfig} disabled={cfgBusy || !cfgEndpoint.trim()}>
          {cfgBusy ? L("保存中…", "saving…") : L("保存连接", "Save")}
        </button>
      </div>
      <div className="cf-config-hint">
        {L(
          "密码仅保存在服务器并随 Supabase 持久化，不会回传浏览器；保存后重启也不丢。",
          "The password is stored server-side and persisted via Supabase; it is never sent back to the browser and survives restarts."
        )}
      </div>
    </div>
  );

  if (configured === null) {
    return <div className="empty-state" style={{ margin: 16 }}>· · ·</div>;
  }

  if (configured === false) {
    return (
      <div className="cf-view">
        <div className="cf-config-empty">
          <div className="cf-config-head">
            <span className="big">{L("连接临时邮箱服务", "Connect a temp-mail provider")}</span>
            <small>
              {L(
                "填入自建临时邮箱（webhostmost / CF）的接口与密码即可启用，无需改服务器环境变量。",
                "Add your self-hosted temp-mail (webhostmost / CF) endpoint and password to enable — no server env edits needed."
              )}
            </small>
          </div>
          {configForm}
        </div>
      </div>
    );
  }

  return (
    <div className="cf-view">
      <div
        className="cf-toolbar"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "0 0 12px" }}
      >
        {/* 来源切换已在侧栏「来源」，这里不再重复一个下拉 */}
        <AliasPicker
          aliases={aliases}
          value={selectedAlias}
          onChange={setSelectedAlias}
          lang={lang}
        />
        <button onClick={() => loadInbox()} disabled={!selectedAlias || busy}>
          {busy ? L("加载中…", "loading…") : L("↻ 刷新", "↻ refresh")}
        </button>
        <button
          className="primary"
          onClick={() => setComposeOpen((v) => !v)}
          disabled={!isIcloud && !selectedAlias}
        >
          {L("写信", "Compose")}
        </button>
        {curType === "php" && (
          <button
            className={fwdOpen ? "active" : ""}
            onClick={() => setFwdOpen((v) => !v)}
            title={L("转发设置", "Forwarding")}
          >
            {L("转发", "Forward")}
            {(aliasFwdEnabled || globalFwdEnabled) && <span className="fwd-dot" />}
          </button>
        )}
        <button
          className={`icon-btn toolbar-icon ${cfgOpen ? "active" : ""}`}
          onClick={() => setCfgOpen((v) => !v)}
          title={L("连接设置（主源）", "Connection settings")}
          aria-label={L("连接设置", "Connection settings")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {selectedAlias && (
          <button className="ghost cf-del" onClick={() => handleDeleteAlias(selectedAlias)}>
            {L("删除此别名", "Delete alias")}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <span className="cf-create">
        <input
          value={newLocal}
          onChange={(e) => setNewLocal(e.target.value.replace(/[^a-z0-9]/gi, "").toLowerCase())}
          placeholder={L("新别名前缀", "new alias")}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          style={{ width: 140 }}
        />
        <span className="cf-domain mono">@{domain || "…"}</span>
        <button onClick={handleCreate} disabled={!newLocal.trim()}>
          {L("创建", "Create")}
        </button>
        </span>
      </div>

      {composeOpen && (
        <div className="compose-overlay" onClick={() => setComposeOpen(false)}>
          <div
            className="compose-card"
            role="dialog"
            aria-modal="true"
            aria-label={L("写邮件", "Compose")}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="compose-head">
              <h2>
                {L("写邮件", "Compose")}
                <span className="dot-accent">.</span>
              </h2>
              <button className="icon-btn" onClick={() => setComposeOpen(false)} aria-label={L("关闭", "Close")}>
                ×
              </button>
            </header>
            <div className="compose-fields">
              <div className="cf-row">
                <span className="cf-k">{L("发件人", "From")}</span>
                {isIcloud ? (
                  <input
                    value={fromAddr}
                    onChange={(e) => setFromAddr(e.target.value)}
                    placeholder={L("发件地址（留空 = 账号主地址）", "from address (empty = primary)")}
                    spellCheck={false}
                  />
                ) : (
                  <span className="cf-static">{aliasAddress(selectedAlias)}</span>
                )}
              </div>
              <div className="cf-row">
                <span className="cf-k">{L("收件人", "To")}</span>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder={L("逗号 / 空格分隔", "comma / space separated")}
                  spellCheck={false}
                  autoFocus
                />
              </div>
              <div className="cf-row">
                <span className="cf-k">{L("主题", "Subject")}</span>
                <input
                  className="cf-subj"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={L("主题", "Subject")}
                />
              </div>
            </div>
            <div className="compose-body">
              <textarea
                className="compose-text"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={L("正文", "Body")}
              />
            </div>
            <footer className="compose-foot">
              <button className="ghost" onClick={() => setComposeOpen(false)} disabled={sendBusy}>
                {L("取消", "Cancel")}
              </button>
              <button className="primary" onClick={handleSend} disabled={sendBusy || !to.trim()}>
                {sendBusy ? L("发送中…", "Sending…") : L("发送", "Send")}
              </button>
            </footer>
          </div>
        </div>
      )}
      {curType === "php" && fwdOpen && (
        <div className="compose-overlay" onClick={() => setFwdOpen(false)}>
          <div
            className="compose-card"
            role="dialog"
            aria-modal="true"
            aria-label={L("转发设置", "Forwarding")}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="compose-head">
              <h2>
                {L("转发设置", "Forwarding")}
                <span className="dot-accent">.</span>
              </h2>
              <button className="icon-btn" onClick={() => setFwdOpen(false)} aria-label={L("关闭", "Close")}>
                ×
              </button>
            </header>
            <div className="modal-scroll">
        <div className="fwd-panel">
          <p className="fwd-intro">
            {L("转发的意思：收到的信，再复制一份送到你指定的另一个邮箱（比如你自己的 Gmail）。", "Forwarding means: incoming mail also gets a copy sent to another mailbox you choose (e.g. your own Gmail).")}
          </p>
          <div className="fwd-row">
            <div className="fwd-head">
              <label className="fwd-toggle">
                <input
                  type="checkbox"
                  checked={aliasFwdEnabled}
                  disabled={!selectedAlias}
                  onChange={(e) => setAliasFwdEnabled(e.target.checked)}
                />
                <span>{L("只转发这一个地址", "Forward this address only")}</span>
              </label>
              <span className="fwd-target mono">
                {selectedAlias ? aliasAddress(selectedAlias) : L("先选一个地址", "pick an address first")}
              </span>
            </div>
            <input
              value={aliasFwdTo}
              disabled={!selectedAlias}
              onChange={(e) => setAliasFwdTo(e.target.value)}
              placeholder={L("接收转发的邮箱，多个用逗号隔开（最多 5 个）", "emails to forward to, comma separated (max 5)")}
            />
            <button onClick={saveAliasForwarding} disabled={fwdBusy || !selectedAlias}>
              {fwdBusy ? L("保存中…", "saving…") : L("保存", "Save")}
            </button>
          </div>
          <div className="fwd-hint">
            {L(
              "开启后，凡是寄到这个地址的信，都会再复制一份发给你填的邮箱。复制出去的信，标题前面会带上原收件地址，方便你看清是哪封。",
              "When on, every message sent to this address is also copied to the emails you list. The recipient address is prepended to the subject so you can tell which address it came in on."
            )}
          </div>
          <div className="fwd-divider" />
          <div className="fwd-row">
            <div className="fwd-head">
              <label className="fwd-toggle">
                <input
                  type="checkbox"
                  checked={globalFwdEnabled}
                  onChange={(e) => setGlobalFwdEnabled(e.target.checked)}
                />
                <span>{L("整个域名一起转发", "Forward the whole domain")}</span>
              </label>
              <span className="fwd-target mono">@{domain || "…"}</span>
            </div>
            <input
              value={globalFwdTo}
              onChange={(e) => setGlobalFwdTo(e.target.value)}
              placeholder={L("接收转发的邮箱，多个用逗号隔开（最多 5 个）", "emails to forward to, comma separated (max 5)")}
            />
            <button onClick={saveGlobalForwarding} disabled={fwdBusy}>
              {fwdBusy ? L("保存中…", "saving…") : L("保存", "Save")}
            </button>
          </div>
        </div>
            </div>
            <footer className="compose-foot">
              <button className="ghost" onClick={() => setFwdOpen(false)}>
                {L("关闭", "Close")}
              </button>
            </footer>
          </div>
        </div>
      )}

      {cfgOpen && (
        <div className="compose-overlay" onClick={() => setCfgOpen(false)}>
          <div
            className="compose-card"
            role="dialog"
            aria-modal="true"
            aria-label={L("连接设置", "Connection settings")}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="compose-head">
              <h2>
                {L("连接设置", "Connection settings")}
                <span className="dot-accent">.</span>
              </h2>
              <button className="icon-btn" onClick={() => setCfgOpen(false)} aria-label={L("关闭", "Close")}>
                ×
              </button>
            </header>
            <div className="modal-scroll">
              {configForm}
            </div>
            <footer className="compose-foot">
              <button className="ghost" onClick={() => setCfgOpen(false)}>
                {L("关闭", "Close")}
              </button>
            </footer>
          </div>
        </div>
      )}

      <div className="inbox" style={{ ["--list-width" as string]: `${list.width}px` }}>
        <section className="list-pane">
          <div className="pane-head">
            <span className="label">{selectedAlias ? aliasAddress(selectedAlias) : L("先选一个地址", "pick an address first")}</span>
            <span className="tag muted">{messages.length}</span>
          </div>
          {selectedAlias && messages.length > 0 && (
            <div className="list-search">
              <SearchBox
                value={query}
                onChange={setQuery}
                items={searchItems}
                placeholder={L("搜索邮件…", "Search mail…")}
                lang={lang}
                storageKey="clawemail:search:edu"
              />
            </div>
          )}
          <div className="scroll">
            {messages.length === 0 && (
              <div className="empty-state" style={{ margin: 16, border: "1px dashed var(--line)" }}>
                <span className="big">{L("暂无邮件", "No mail")}</span>
                {L("选择或创建别名后在此查看收件。", "Pick or create an alias to see inbound mail.")}
              </div>
            )}
            {messages
              .filter((m) => {
                const q = query.trim().toLowerCase();
                if (!q) return true;
                return (
                  (m.subject || "").toLowerCase().includes(q) ||
                  (m.from || "").toLowerCase().includes(q) ||
                  (m.preview || "").toLowerCase().includes(q)
                );
              })
              .map((m) => (
                <button
                  key={m.uid}
                  className={`mail-row ${selected?.uid === m.uid ? "selected" : ""}`}
                  onClick={() => openMessage(m.uid)}
                >
                  <span className="subj">{m.subject || L("（无主题）", "(no subject)")}</span>
                  <span className="time">{(m.date || "").replace(/ 北京时间$/, "").slice(5, 16)}</span>
                  <span className="meta">
                    <span className="from">{m.from || L("未知发件人", "unknown")}</span>
                  </span>
                  {m.preview && <span className="preview">{m.preview}</span>}
                </button>
              ))}
          </div>
        </section>

        <div
          className={`list-resizer ${list.dragging ? "dragging" : ""}`}
          onPointerDown={list.onPointerDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="resize mail list"
        />

        <section className="detail-pane">
          {!selected && (
            <div className="detail-empty">
              <div className="empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m2 7 10 6 10-6" />
                </svg>
              </div>
              {L("选择一封邮件查看", "Pick a message")}
              <small>{domain ? `@${domain}` : ""}</small>
            </div>
          )}
          {selected && (
            <>
              <div className="detail-head">
                <div className="crumbs">
                  <span>{L("别名", "ALIAS")}</span>
                  <span style={{ color: "var(--text-4)" }}>/</span>
                  <span className="mono">#{selected.uid}</span>
                </div>
                <h2>{selected.subject || L("（无主题）", "(no subject)")}</h2>
                <dl>
                  <dt>{L("发件", "From")}</dt>
                  <dd className="mono">{selected.from || "—"}</dd>
                  <dt>{L("收件", "To")}</dt>
                  <dd className="mono">{selected.to || aliasAddress(selectedAlias)}</dd>
                  <dt>{L("时间", "At")}</dt>
                  <dd className="mono">{selected.date || "—"}</dd>
                </dl>
                <CodeReadout
                  subject={selected.subject}
                  text={selected.bodyText || selected.preview}
                  html={selected.bodyHtml}
                  lang={lang}
                />
              </div>
              <div className="detail-body">
                {selected.bodyHtml ? (
                  <div className="frame">
                    <iframe
                      title="cf-mail-html"
                      sandbox="allow-same-origin"
                      referrerPolicy="no-referrer"
                      srcDoc={wrapEmailHtml(selected.bodyHtml)}
                      onLoad={(e) => {
                        const f = e.currentTarget;
                        try {
                          const h = f.contentDocument?.body?.scrollHeight;
                          if (h) f.style.height = `${Math.min(h + 28, 4000)}px`;
                        } catch { /* 跨域兜底：保持 min-height */ }
                      }}
                    />
                  </div>
                ) : (
                  <pre>{selected.bodyText || selected.preview || L("（空）", "(empty)")}</pre>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
