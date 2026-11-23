const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const mainNavItems = $$('.rail-item[data-group]');
const subNavGroups = $$('.subnav-group[data-subnav-group]');
const subNavItems = $$('.subnav-item[data-subview]');
const viewPanels = $$('.view-panel[data-group-panel][data-view-panel]');
const workbench = $('.workbench');
const saveBar = $('.save-bar');
const defaultGrokSystemPrompt = [
  'You are FusionSearch MCP, a careful web research assistant.',
  'Tools and model-side analysis should operate in English when useful; final user-facing answers should be written in Chinese unless the user requests another language.',
  'Search results are evidence, not automatic truth. Cross-check important factual claims across independent sources whenever evidence is available.',
  'Prefer authoritative, recent, primary sources. State uncertainty, conflicts, scope limits, and confidence level when the evidence is incomplete.',
  'Use concise Markdown. Put direct conclusions first, then evidence and citations. Never fabricate citations.'
].join('\n');

const defaultSubviews = {
  sources: 'libresearch',
  fusion: 'keys',
  mcp: 'full',
  deploy: 'docker',
  security: 'session',
  tests: 'libresearch-test',
  status: 'monitoring'
};

// 无底栏保存动作的栏目（只读页 + 自带保存按钮的独立页）
const READONLY_GROUPS = new Set(['tests', 'status', 'mcp', 'deploy', 'security']);
const SELF_SAVED_VIEWS = new Set(['fusion:keys', 'fusion:perplexity']);
let currentGroup = 'sources';
let currentSubview = 'libresearch';

const legacyRoutes = {
  libresearch: ['sources', 'libresearch'],
  search2api: ['sources', 'search2api'],
  fusion: ['fusion', 'keys'],
  keys: ['fusion', 'keys'],
  grok: ['fusion', 'grok'],
  prompt: ['fusion', 'prompt'],
  tavily: ['fusion', 'tavily'],
  firecrawl: ['fusion', 'firecrawl'],
  preview: ['tests', 'libresearch-test'],
  search: ['tests', 'libresearch-test'],
  'fusion-test': ['tests', 'grok-test'],
  fetch: ['tests', 'tavily-test'],
  runtime: ['status', 'runtime'],
  monitoring: ['status', 'monitoring']
};

const fields = {
  searchEndpoint: $('#searchEndpoint'),
  searchShEndpoint: $('#searchShEndpoint'),
  search2apiProjectUrl: $('#search2apiProjectUrl'),
  search2apiBaseUrl: $('#search2apiBaseUrl'),
  search2apiUpstreamState: $('#search2apiUpstreamState'),
  search2apiRuntimeState: $('#search2apiRuntimeState'),
  search2apiStatusHint: $('#search2apiStatusHint'),
  grokApiUrl: $('#grokApiUrl'),
  grokEnvLock: $('#grokEnvLock'),
  grokModel: $('#grokModel'),
  grokModelList: $('#grokModelList'),
  grokModelHint: $('#grokModelHint'),
  grokChainList: $('#grokChainList'),
  syncGrokHfSecrets: $('#syncGrokHfSecrets'),
  grokHfToken: $('#grokHfToken'),
  grokSystemPrompt: $('#grokSystemPrompt'),
  resetGrokPrompt: $('#resetGrokPrompt'),
  tavilyEnabled: $('#tavilyEnabled'),
  tavilyProvider: $('#tavilyProvider'),
  tavilyProviderChoices: $$('input[name="tavilyProviderChoice"]'),
  tavilyProviderOptions: $$('[data-tavily-provider-option]'),
  tavilyProviderPanels: $$('[data-tavily-provider-panel]'),
  tavilyApiUrl: $('#tavilyApiUrl'),
  tavilyMcpUrl: $('#tavilyMcpUrl'),
  tavilyMcpSearchTool: $('#tavilyMcpSearchTool'),
  tavilyMcpExtractTool: $('#tavilyMcpExtractTool'),
  tavilyMcpMapTool: $('#tavilyMcpMapTool'),
  firecrawlApiUrl: $('#firecrawlApiUrl'),
  serperApiUrl: $('#serperApiUrl'),
  serperConfiguredState: $('#serperConfiguredState'),
  serperTestHint: $('#serperTestHint'),
  exaApiUrl: $('#exaApiUrl'),
  exaConfiguredState: $('#exaConfiguredState'),
  exaTestHint: $('#exaTestHint'),
  perplexityModelSelect: $('#perplexityModelSelect'),
  perplexityModelHint: $('#perplexityModelHint'),
  perplexityCookieInput: $('#perplexityCookieInput'),
  perplexityCookieState: $('#perplexityCookieState'),
  perplexityCookieHint: $('#perplexityCookieHint'),
  perplexityConfiguredState: $('#perplexityConfiguredState'),
  perplexityTestHint: $('#perplexityTestHint'),
  keyStatusGrid: $('#keyStatusGrid'),
  keyStatusHint: $('#keyStatusHint'),
  categories: $('#categories'),
  language: $('#language'),
  safesearch: $('#safesearch'),
  timeRange: $('#timeRange'),
  testQuery: $('#testQuery'),
  testPrompt: $('#testPrompt'),
  testGrokQuery: $('#testGrokQuery'),
  testTavilyQuery: $('#testTavilyQuery'),
  testFetchUrl: $('#testFetchUrl'),
  testMapUrl: $('#testMapUrl'),
  testFirecrawlUrl: $('#testFirecrawlUrl'),
  testPerplexityQuery: $('#testPerplexityQuery'),
  output: $('#testOutput'),
  runtimeStatus: $('#runtimeStatus'),
  toastHost: $('#toastHost'),
  loginPanel: $('#loginPanel'),
  adminTokenInput: $('#adminTokenInput'),
  loginHint: $('#loginHint'),
  loginAdmin: $('#loginAdmin'),
  logoutAdmin: $('#logoutAdmin'),
  mcpEndpoint: $('#mcpEndpoint'),
  healthState: $('#healthState'),
  configPath: $('#configPath'),
  configPathMirror: $('#configPathMirror'),
  hfSpaceIdState: $('#hfSpaceIdState'),
  hfCanWriteState: $('#hfCanWriteState'),
  currentOriginState: $('#currentOriginState'),
  grokInlineHint: $('#grokInlineHint'),
  adminAuthState: $('#adminAuthState'),
  mcpAuthState: $('#mcpAuthState'),
  rotateSessionSecret: $('#rotateSessionSecret'),
  syncSecurityHfSecrets: $('#syncSecurityHfSecrets'),
  securityHfToken: $('#securityHfToken'),
  securityHint: $('#securityHint'),
  keysWriteHf: $('#keysWriteHf'),
  keysHfToken: $('#keysHfToken'),
  logFilePath: $('#logFilePath'),
  logCount: $('#logCount'),
  logLevel: $('#logLevel'),
  logScope: $('#logScope'),
  logLimit: $('#logLimit'),
  logViewer: $('#logViewer'),
  monitoringCount: $('#monitoringCount'),
  monitoringHeadline: $('#monitoringHeadline'),
  monitorBars: $('#monitorBars'),
  monitoringHint: $('#monitoringHint'),
  monitoringServices: $('#monitoringServices'),
  keyState: $('#keyState'),
  fusionKeyState: $('#fusionKeyState'),
  saveHint: $('#saveHint')
};

// 常驻候选模型（2026-11 grok-4.7 主力 + 4.6 兜底；4.5 已从网关下线）
let grokModelOptions = ['grok-4.7', 'grok-4.6'];

function setStatus(text, kind = '') {
  fields.runtimeStatus.textContent = text;
  fields.runtimeStatus.className = `status-pill ${kind}`.trim();
}

function showToast(text, kind = '') {
  if (!fields.toastHost || !text) return;
  const item = document.createElement('div');
  item.className = `toast-item ${kind}`.trim();
  item.textContent = String(text);
  fields.toastHost.append(item);
  while (fields.toastHost.children.length > 3) {
    fields.toastHost.firstElementChild?.remove();
  }
  window.setTimeout(() => item.remove(), 4200);
}

function shouldHideSaveBar(group = currentGroup, subview = currentSubview) {
  return READONLY_GROUPS.has(group) || SELF_SAVED_VIEWS.has(`${group}:${subview}`);
}

function renderOutput(value) {
  if (!fields.output) return;
  fields.output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function formatFusionKeyState(fusion = {}) {
  const providers = [
    fusion.hasGrokApiKey ? 'Grok' : '',
    fusion.hasTavilyCredentials ? `Tavily ${fusion.tavilyProvider === 'mcp' ? 'MCP' : 'REST'}` : '',
    fusion.hasFirecrawlApiKey ? 'Firecrawl' : ''
  ].filter(Boolean);
  return providers.length ? `${providers.join(' / ')} 已配置` : '未配置';
}

function getTavilyProvider() {
  const selected = fields.tavilyProviderChoices.find((choice) => choice.checked)?.value;
  return selected === 'mcp' ? 'mcp' : 'rest';
}

function setTavilyProvider(value = 'rest') {
  const provider = value === 'mcp' ? 'mcp' : 'rest';
  if (fields.tavilyProvider) {
    fields.tavilyProvider.value = provider;
  }
  fields.tavilyProviderChoices.forEach((choice) => {
    choice.checked = choice.value === provider;
  });
  fields.tavilyProviderOptions.forEach((option) => {
    const isActive = option.dataset.tavilyProviderOption === provider;
    option.classList.toggle('active', isActive);
    option.setAttribute('aria-checked', String(isActive));
  });
  fields.tavilyProviderPanels.forEach((panel) => {
    panel.hidden = panel.dataset.tavilyProviderPanel !== provider;
  });
}

function normalizeModelList(models = []) {
  return Array.from(new Set(
    models
      .map((model) => String(model || '').trim())
      .filter(Boolean)
  ));
}

// GROK_MODEL = 逗号分隔的降级链：第 1 个是主模型，其余按序 fallback。
// executeGrokWebSearch 按此顺序试第一个成功的，主模型挂/超时自动降级下一个。
function getGrokChain() {
  return String(fields.grokModel?.value || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

function getCurrentGrokModel() {
  return getGrokChain()[0] || 'grok-4.7';
}

function setGrokChain(chain, { source = '', touch = true } = {}) {
  const normalized = normalizeModelList(chain);
  if (fields.grokModel) fields.grokModel.value = normalized.join(',');
  renderGrokModels(grokModelOptions, { source });
  if (touch && fields.saveHint) fields.saveHint.textContent = '模型顺序已更新，保存后生效';
}

function renderGrokChain(chain = getGrokChain()) {
  if (!fields.grokChainList) return;
  if (!chain.length) {
    fields.grokChainList.innerHTML =
      '<li class="chain-empty">降级链为空 —— 读取或点选下方可用模型加入。</li>';
    return;
  }
  fields.grokChainList.innerHTML = chain
    .map((model, i) => `
      <li class="chain-item" data-idx="${i}">
        <span class="chain-rank">${i + 1}</span>
        <span class="chain-name">${escapeHtml(model)}</span>
        <span class="chain-tag">${i === 0 ? '主模型' : '降级 ' + i}</span>
        <span class="chain-ops">
          <button type="button" class="chain-op" data-op="up" ${i === 0 ? 'disabled' : ''} title="上移" aria-label="上移 ${escapeHtml(model)}">&#8593;</button>
          <button type="button" class="chain-op" data-op="down" ${i === chain.length - 1 ? 'disabled' : ''} title="下移" aria-label="下移 ${escapeHtml(model)}">&#8595;</button>
          <button type="button" class="chain-op chain-op-remove" data-op="remove" title="移除" aria-label="移除 ${escapeHtml(model)}">&times;</button>
        </span>
      </li>
    `)
    .join('');
}

function grokChainOp(idx, op) {
  const chain = getGrokChain();
  if (idx < 0 || idx >= chain.length) return;
  if (op === 'remove') {
    chain.splice(idx, 1);
  } else if (op === 'up' && idx > 0) {
    [chain[idx - 1], chain[idx]] = [chain[idx], chain[idx - 1]];
  } else if (op === 'down' && idx < chain.length - 1) {
    [chain[idx + 1], chain[idx]] = [chain[idx], chain[idx + 1]];
  } else {
    return;
  }
  setGrokChain(chain, { source: '手动排序' });
}

function toggleGrokModel(model) {
  if (!model) return;
  const chain = getGrokChain();
  const at = chain.indexOf(model);
  if (at >= 0) chain.splice(at, 1);
  else chain.push(model);
  setGrokChain(chain, { source: at >= 0 ? '移出链' : '加入链' });
}

function renderGrokModels(models = grokModelOptions, { source = '' } = {}) {
  if (!fields.grokModelList) return;
  const chain = getGrokChain();
  const normalized = normalizeModelList([...chain, ...models]);
  grokModelOptions = normalized;

  fields.grokModelList.innerHTML = normalized
    .map((model) => {
      const rank = chain.indexOf(model);
      const inChain = rank >= 0;
      const tag = !inChain
        ? '点击加入降级链'
        : rank === 0
          ? '主模型 · 点击移出'
          : `降级 ${rank} · 点击移出`;
      return `
        <button class="model-card ${inChain ? 'active' : ''}" type="button" data-model-id="${escapeHtml(model)}" aria-pressed="${String(inChain)}">
          <strong>${escapeHtml(model)}</strong>
          <small>${tag}</small>
        </button>
      `;
    })
    .join('');

  if (fields.grokModelHint) {
    const countText = `降级链 ${chain.length} 个 · 可选 ${normalized.length} 个`;
    fields.grokModelHint.textContent = source ? `${source} · ${countText}` : countText;
  }
  renderGrokChain(chain);
}

let revealedValuesCache = null;

// Fetch the live effective values once per render so eye-toggles show real plaintext
// (env var OR runtime config) without re-hitting the server on every click. Reset
// whenever the key list re-renders.
async function ensureRevealValues() {
  if (revealedValuesCache) return revealedValuesCache;
  const payload = await requestJson('/api/admin/keys/reveal');
  revealedValuesCache = payload?.values || {};
  return revealedValuesCache;
}

// One delegated listener on the grid; survives innerHTML re-renders of the cards.
function bindKeyReveal() {
  if (!fields.keyStatusGrid || fields.keyStatusGrid.dataset.revealBound) return;
  fields.keyStatusGrid.dataset.revealBound = '1';
  fields.keyStatusGrid.addEventListener('click', async (event) => {
    const btn = event.target.closest('.key-eye');
    if (!btn) return;
    const card = btn.closest('.key-status-card');
    const code = card?.querySelector('code');
    if (!code) return;
    const keyId = card.dataset.keyId || '';
    if (card.classList.contains('revealed')) {
      code.textContent = code.dataset.masked || '未设置';
      card.classList.remove('revealed');
      btn.textContent = '查看';
      btn.setAttribute('aria-label', '显示明文');
      return;
    }
    btn.disabled = true;
    try {
      const values = await ensureRevealValues();
      const value = values[keyId];
      code.textContent = (value === undefined || value === '')
        ? '（当前未配置）'
        : value;
      card.classList.add('revealed');
      btn.textContent = '隐藏';
      btn.setAttribute('aria-label', '隐藏明文');
    } catch (error) {
      code.textContent = `读取失败：${error?.message || error}`;
    } finally {
      btn.disabled = false;
    }
  });
}

// Per-row editing rules for the unified key center. Mirrors KEY_CENTER_FIELDS on the
// server: which rows are editable, whether they write back to HF, whether they can be
// cleared, and the small footnote hint.
const KEY_CENTER_META = {
  libresearchEndpoint: { editable: false, hf: false },
  search2apiBearer: { editable: true, hf: true, clear: true },
  search2apiCookie: { editable: true, hf: true, clear: false, note: '环境变量项，保存后需重启服务生效' },
  grokApiUrl: { editable: true, hf: true, clear: false, plain: true, note: '立即生效并同步云端变量，地址需以 /v1 结尾' },
  grokModel: { editable: true, hf: true, clear: false, plain: true, note: '英文逗号分隔优先级，排最前面的是主力模型' },
  grokApiKey: { editable: true, hf: true, clear: true, note: '立即生效并同步云端密钥' },
  tavilyApiKey: { editable: true, hf: true, clear: true },
  tavilyMcpToken: { editable: true, hf: true, clear: true },
  firecrawlApiKey: { editable: true, hf: true, clear: true },
  serperApiUrl: { editable: true, hf: true, clear: false, plain: true, note: '默认 https://google.serper.dev，通常不用改' },
  serperApiKey: { editable: true, hf: true, clear: true, note: '按次计费，自动体检不会消耗额度' },
  exaApiUrl: { editable: true, hf: true, clear: false, plain: true, note: '默认 https://api.exa.ai，通常不用改' },
  exaApiKey: { editable: true, hf: true, clear: true, note: '按量计费，自动体检不会消耗额度' },
  adminToken: { editable: true, hf: true, clear: false, note: '修改后需要用新口令重新登录' },
  mcpAuthToken: { editable: true, hf: true, clear: true },
  search2apiBaseUrl: { editable: true, hf: true, clear: false, note: '代理出口设置，保存后需重启服务生效' },
  searxngEngineProxy: { editable: true, hf: true, clear: false, note: '挑 IP 引擎专用代理，保存后需重启生效' },
  searxngProxy: { editable: true, hf: true, clear: false, note: '全局兜底代理，保存后需重启生效' }
};

function renderKeyStatus(items = []) {
  if (!fields.keyStatusGrid) return;
  revealedValuesCache = null;
  fields.keyStatusGrid.innerHTML = items.length
    ? items.map((item) => {
      const meta = KEY_CENTER_META[item.id] || { editable: false, hf: false };
      const masked = item.masked || '未设置';
      const eye = item.configured
        ? `<button type="button" class="key-eye" aria-label="显示明文" title="查看或隐藏明文">查看</button>`
        : '';
      const tag = meta.hf ? '<span class="key-tag">云端同步</span>' : '';
      const editor = meta.editable
        ? `
        <div class="key-edit">
          <input class="key-edit-input" type="${meta.plain ? 'text' : 'password'}" autocomplete="new-password" placeholder="留空不改，填写即替换" data-key-id="${escapeHtml(item.id)}" />
          ${meta.clear ? `<label class="key-clear"><input type="checkbox" class="key-clear-box" data-key-id="${escapeHtml(item.id)}" />清空</label>` : ''}
        </div>
        ${meta.note ? `<small class="key-note">${escapeHtml(meta.note)}</small>` : ''}`
        : '<small class="key-note">请在对应的基础搜索面板中修改</small>';
      return `
      <article class="key-status-card ${item.configured ? 'configured' : 'missing'}" data-key-id="${escapeHtml(item.id)}">
        <div>
          <span>${escapeHtml(item.label)}${tag}</span>
          <div class="key-actions"><strong>${item.configured ? '已配置' : '未配置'}</strong>${eye}</div>
        </div>
        <code data-masked="${escapeHtml(masked)}">${escapeHtml(masked)}</code>
        <small>${escapeHtml(formatKeySource(item))}</small>
        ${editor}
      </article>`;
    }).join('')
    : '<div class="empty-note">暂无密钥项</div>';
  bindKeyReveal();
}

// When the Space already has HF_WRITE_TOKEN + Space ID, the one-time-token inputs are
// pure noise — hide them and show a calm "ready" line instead. Only surface an input
// when write-back couldn't otherwise happen.
function applyHfTokenVisibility(canWrite) {
  const pairs = [
    ['keysHfTokenField', 'keysHfReady'],
    ['securityHfTokenField', 'securityHfReady'],
    ['grokHfTokenField', 'grokHfReady']
  ];
  for (const [fieldId, readyId] of pairs) {
    const field = document.getElementById(fieldId);
    const ready = document.getElementById(readyId);
    if (field) field.hidden = Boolean(canWrite);
    if (ready) ready.hidden = !canWrite;
  }
}

const SERVICE_TEST_SUBVIEW = {
  libresearch: 'libresearch-test',
  search2api: 'search2api-test',
  grok: 'grok-test',
  tavily: 'tavily-test',
  firecrawl: 'firecrawl-test',
  perplexity: 'perplexity-test',
  serper: 'serper-test',
  exa: 'exa-test'
};

const SOURCE_LABEL_MAP = {
  smart_research: '聚合搜索',
  smart_fetch: '网页抓取',
  probe: '体检探针',
  'admin-test': '手动测试',
  config: '配置检查',
  'config-missing': '未配置',
  runtime: '运行时'
};

const STATUS_CN_MAP = {
  up: '正常',
  warning: '待确认',
  down: '异常',
  paused: '未启用'
};

function formatKeySource(item) {
  const source = item.source || 'missing';
  if (source === 'runtime') return '来源：运行时配置';
  if (source === 'missing') return '尚未设置';
  const meta = item.meta || {};
  const extra = item.id === 'search2apiCookie'
    ? `（含 cf_clearance：${meta.hasCfClearance ? '是' : '否'}，含 UA：${meta.hasUserAgent ? '是' : '否'}）`
    : '';
  return `来源：环境变量 ${source}${extra}`;
}

function renderMonitoring(snapshot = {}) {
  const services = snapshot.services || [];
  const counts = snapshot.counts || {};
  const total = snapshot.count ?? services.length;
  const upCount = counts.up || 0;
  if (fields.monitoringCount) fields.monitoringCount.textContent = `${upCount}/${total}`;
  if (fields.monitoringHeadline) {
    fields.monitoringHeadline.textContent = counts.down
      ? `正常通道数（${counts.down} 个需要处理）`
      : '全部已启用通道运行正常';
  }

  // Summary bar: one clickable colored pill per service.
  if (fields.monitorBars) {
    fields.monitorBars.innerHTML = services
      .map((service) => {
        const cn = STATUS_CN_MAP[service.status] || service.statusLabel || '待确认';
        return `<button type="button" class="monitor-bar ${escapeHtml(service.status)}" data-jump-service="${escapeHtml(service.id)}" title="${escapeHtml(service.name)}：${escapeHtml(cn)}（点击跳转卡片）" aria-label="${escapeHtml(service.name)} ${escapeHtml(cn)}"></button>`;
      })
      .join('');
  }

  // Service health cards with 48-slot history strip.
  if (fields.monitoringServices) {
    if (!services.length) {
      fields.monitoringServices.innerHTML = '<div class="empty-note">暂无监控通道</div>';
    } else {
      const CELLS = 48;
      fields.monitoringServices.innerHTML = services.map((service) => {
        const history = Array.isArray(service.history) ? service.history : [];
        const padded = Array(Math.max(0, CELLS - history.length)).fill(null).concat(history);
        const cells = padded.map((point) => {
          if (!point) {
            return `<span class="history-cell empty" title="暂无记录"></span>`;
          }
          const label = STATUS_CN_MAP[point.status] || point.status;
          const ts = point.ts ? new Date(point.ts).toLocaleString('zh-CN', { hour12: false }) : '';
          return `<span class="history-cell ${escapeHtml(point.status)}" title="${escapeHtml(ts + (ts ? ' · ' : '') + label)}"></span>`;
        }).join('');
        const uptimeText = service.uptime24h == null ? '暂无统计' : `可用率 ${service.uptime24h.toFixed(1)}%`;
        const cnStatus = STATUS_CN_MAP[service.status] || service.statusLabel || '待确认';
        const cardStateClass = service.status === 'down' ? 'is-down' : service.status === 'warning' ? 'is-warning' : '';
        const testSubview = SERVICE_TEST_SUBVIEW[service.id];
        const quickBtn = testSubview
          ? `<button type="button" class="uptimer-quick-btn" data-goto-test="${escapeHtml(testSubview)}">去测试</button>`
          : '';
        return `
          <div class="uptimer-card ${cardStateClass}" id="monitor-card-${escapeHtml(service.id)}">
            <div class="uptimer-head">
              <div class="uptimer-title-group">
                <span class="uptimer-dot ${escapeHtml(service.status)}" title="${escapeHtml(cnStatus)}"></span>
                <strong>${escapeHtml(service.name)}</strong>
                <span class="uptimer-badge ${escapeHtml(service.status)}">${escapeHtml(cnStatus)}</span>
                <span class="uptimer-type">${escapeHtml(service.type)}</span>
              </div>
              <div class="uptimer-meta-group">
                <span class="uptimer-uptime">${escapeHtml(uptimeText)}</span>
                <small class="uptimer-check">${escapeHtml(formatMonitorCheck(service))}</small>
                ${quickBtn}
              </div>
            </div>
            <div class="history-grid">${cells}</div>
            <p class="uptimer-msg">${escapeHtml(service.message || '等待首次调用或体检')}</p>
          </div>
        `;
      }).join('');
    }
  }

  if (fields.monitoringHint) {
    const parts = [
      `正常 ${counts.up || 0}`,
      counts.warning ? `待确认 ${counts.warning}` : '',
      counts.down ? `异常 ${counts.down}` : '',
      counts.paused ? `未启用 ${counts.paused}` : ''
    ].filter(Boolean);
    const probe = snapshot.probe?.skipped ? `（${snapshot.probe.reason}）` : '';
    fields.monitoringHint.textContent = `${parts.join(' / ')}${probe}`;
  }
}

function formatMonitorCheck(service) {
  const time = service.checkedAt ? formatShortTime(service.checkedAt) : '尚未检测';
  const ms = service.responseTimeMs == null ? '' : ` · ${service.responseTimeMs}ms`;
  const src = SOURCE_LABEL_MAP[service.source] || service.source || '运行时';
  return `${time}${ms} · ${src}`;
}

function formatShortTime(value) {
  if (!value) return '尚未检测';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function hasPanel(group, subview) {
  return viewPanels.some((panel) => panel.dataset.groupPanel === group && panel.dataset.viewPanel === subview);
}

function normalizeRoute(rawHash = '') {
  const hash = rawHash.replace(/^#/, '').trim();
  if (!hash) return ['sources', defaultSubviews.sources];
  if (legacyRoutes[hash]) return legacyRoutes[hash];

  const [requestedGroup, requestedSubview] = hash.split(':');
  const group = defaultSubviews[requestedGroup] ? requestedGroup : 'sources';
  const subview = requestedSubview || defaultSubviews[group];
  return hasPanel(group, subview) ? [group, subview] : [group, defaultSubviews[group]];
}

function setActiveRoute(group, subview, updateHash = true) {
  const [targetGroup, targetSubview] = hasPanel(group, subview)
    ? [group, subview]
    : ['sources', defaultSubviews.sources];

  mainNavItems.forEach((item) => {
    const active = item.dataset.group === targetGroup;
    item.classList.toggle('active', active);
    item.toggleAttribute('aria-current', active);
  });

  subNavGroups.forEach((navGroup) => {
    const active = navGroup.dataset.subnavGroup === targetGroup;
    navGroup.hidden = !active;
    navGroup.classList.toggle('active', active);
  });

  subNavItems.forEach((item) => {
    const groupElement = item.closest('.subnav-group');
    const active = groupElement?.dataset.subnavGroup === targetGroup && item.dataset.subview === targetSubview;
    item.classList.toggle('active', active);
    item.toggleAttribute('aria-current', active);
  });

  viewPanels.forEach((panel) => {
    const active = panel.dataset.groupPanel === targetGroup && panel.dataset.viewPanel === targetSubview;
    panel.hidden = !active;
    panel.classList.toggle('active-panel', active);
  });

  if (targetGroup === 'tests' && fields.output) {
    const activePanel = viewPanels.find((panel) => (
      panel.dataset.groupPanel === targetGroup && panel.dataset.viewPanel === targetSubview
    ));
    activePanel?.append(fields.output);
  }

  if (targetGroup === 'status' && targetSubview === 'logs' && !workbench.hidden) {
    void loadLogs().catch(() => {});
  }
  if (targetGroup === 'status' && targetSubview === 'monitoring' && !workbench.hidden) {
    void loadMonitoring().catch(() => {});
  }
  if (targetGroup === 'fusion' && targetSubview === 'keys' && !workbench.hidden) {
    void loadKeyStatus().catch(() => {});
  }
  if (targetGroup === 'fusion' && targetSubview === 'perplexity' && !workbench.hidden) {
    void loadPerplexity().catch(() => {});
  }

  const nextHash = `#${targetGroup}:${targetSubview}`;
  if (updateHash && window.location.hash !== nextHash) {
    window.history.replaceState(null, '', nextHash);
  }
  currentGroup = targetGroup;
  currentSubview = targetSubview;
  if (!workbench.hidden) {
    saveBar.hidden = shouldHideSaveBar(targetGroup, targetSubview);
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function requestJson(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

function renderSession(session = {}) {
  const locked = Boolean(session.adminAuthEnabled && !session.adminAuthenticated);
  fields.loginPanel.hidden = !locked;
  workbench.hidden = locked;
  saveBar.hidden = locked || shouldHideSaveBar(currentGroup, currentSubview);
  fields.logoutAdmin.hidden = !session.adminAuthEnabled || locked;
  if (fields.adminAuthState) {
    fields.adminAuthState.textContent = session.adminAuthEnabled ? (session.adminAuthenticated ? '已登录' : '需要登录') : '未启用';
  }
  if (fields.mcpAuthState) {
    fields.mcpAuthState.textContent = session.mcpAuthEnabled ? '已启用' : '未启用';
  }
  setStatus(locked ? '待登录' : '连接中', '');
}

async function hydrateActiveSubview() {
  if (workbench.hidden) return;
  if (currentGroup === 'status' && currentSubview === 'monitoring') {
    await loadMonitoring().catch(() => {});
  } else if (currentGroup === 'status' && currentSubview === 'logs') {
    await loadLogs().catch(() => {});
  } else if (currentGroup === 'fusion' && currentSubview === 'keys') {
    await loadKeyStatus().catch(() => {});
  } else if (currentGroup === 'fusion' && currentSubview === 'perplexity') {
    await loadPerplexity().catch(() => {});
  }
}

async function refreshSession() {
  const session = await requestJson('/api/admin/session');
  renderSession(session);
  return session;
}

async function loginAdmin() {
  const token = fields.adminTokenInput.value.trim();
  if (!token) {
    fields.loginHint.textContent = '请先输入管理口令。';
    return;
  }
  fields.loginHint.textContent = '正在验证口令…';
  const session = await requestJson('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  fields.adminTokenInput.value = '';
  fields.loginHint.textContent = '登录成功，正在载入控制台…';
  renderSession(session);
  await loadConfig();
  await checkRuntime();
  await hydrateActiveSubview();
}

async function logoutAdmin() {
  const session = await requestJson('/api/admin/logout', { method: 'POST' });
  renderSession(session);
}

async function loadConfig() {
  setStatus('读取中');
  const config = await requestJson('/api/admin/config');
  fields.searchEndpoint.value = config.searchEndpoint || '';
  fields.searchShEndpoint.value = config.searchShChatEndpoint || '';
  if (fields.search2apiProjectUrl) fields.search2apiProjectUrl.textContent = config.searchShProjectUrl || 'https://github.com/lza6/Search-2api';
  if (fields.search2apiBaseUrl) fields.search2apiBaseUrl.textContent = config.searchShBaseUrl || '未配置';
  fields.categories.value = config.defaultParams?.categories || 'general';
  fields.language.value = config.defaultParams?.language || 'auto';
  fields.safesearch.value = config.defaultParams?.safesearch || '0';
  fields.timeRange.value = config.defaultParams?.time_range || '';
  fields.configPath.textContent = config.runtimeConfigPath || 'memory';
  if (fields.configPathMirror) fields.configPathMirror.textContent = config.runtimeConfigPath || 'memory';
  fields.keyState.textContent = config.hasSearchShApiKey ? '已配置' : '未配置';
  fields.fusionKeyState.textContent = formatFusionKeyState(config.fusion);
  renderKeyStatus(config.keyStatus || []);
  applyHfTokenVisibility(config.hfSecrets?.canWrite);
  if (fields.hfSpaceIdState) {
    fields.hfSpaceIdState.textContent = config.hfSecrets?.spaceId || '未配置（本地或独立容器）';
  }
  if (fields.hfCanWriteState) {
    fields.hfCanWriteState.textContent = config.hfSecrets?.canWrite ? '已就绪（保存自动回写）' : '未配置写回令牌';
  }
  if (fields.currentOriginState) {
    fields.currentOriginState.textContent = window.location.origin;
  }
  if (fields.adminAuthState) {
    fields.adminAuthState.textContent = config.auth?.adminAuthEnabled ? '已开启' : '未开启';
  }
  if (fields.mcpAuthState) {
    fields.mcpAuthState.textContent = config.auth?.mcpAuthEnabled ? '已开启' : '未开启';
  }
  fields.grokApiUrl.value = config.fusion?.grokApiUrl || '';
  const lockedGrok = ['grokApiUrl', 'grokModel'].filter((key) => config.envOverrides?.[key]);
  if (fields.grokEnvLock) {
    fields.grokEnvLock.hidden = !lockedGrok.length;
    const lockedLabels = lockedGrok.map((k) => (k === 'grokApiUrl' ? '接口地址' : '模型顺序'));
    fields.grokEnvLock.textContent = lockedGrok.length
      ? `提示：${lockedLabels.join('、')}目前由 Hugging Face 环境变量接管。勾选下方「同步写回 Hugging Face」再保存，重启后才会被永久保留。`
      : '';
  }
  fields.grokModel.value = config.fusion?.grokModel || 'grok-4.7,grok-4.6';
  renderGrokModels([], { source: '当前配置' });
  fields.grokSystemPrompt.value = config.fusion?.grokSystemPrompt || defaultGrokSystemPrompt;
  fields.tavilyEnabled.checked = config.fusion?.tavilyEnabled !== false;
  setTavilyProvider(config.fusion?.tavilyProvider || 'rest');
  fields.tavilyApiUrl.value = config.fusion?.tavilyApiUrl || 'https://api.tavily.com';
  fields.tavilyMcpUrl.value = config.fusion?.tavilyMcpUrl || '';
  fields.tavilyMcpSearchTool.value = config.fusion?.tavilyMcpSearchTool || '';
  fields.tavilyMcpExtractTool.value = config.fusion?.tavilyMcpExtractTool || '';
  fields.tavilyMcpMapTool.value = config.fusion?.tavilyMcpMapTool || '';
  fields.firecrawlApiUrl.value = config.fusion?.firecrawlApiUrl || 'https://api.firecrawl.dev/v2';
  if (fields.serperApiUrl) {
    fields.serperApiUrl.value = config.serper?.serperApiUrl || 'https://google.serper.dev';
  }
  if (fields.serperConfiguredState) {
    fields.serperConfiguredState.textContent = config.serper?.hasSerperAccess ? '已配置' : '未配置';
  }
  if (fields.exaApiUrl) {
    fields.exaApiUrl.value = config.exa?.exaApiUrl || 'https://api.exa.ai';
  }
  if (fields.exaConfiguredState) {
    fields.exaConfiguredState.textContent = config.exa?.hasExaAccess ? '已配置' : '未配置';
  }
  if (fields.perplexityModelSelect && config.perplexityModel) {
    fields.perplexityModelSelect.value = config.perplexityModel;
  }
  if (fields.perplexityConfiguredState) {
    fields.perplexityConfiguredState.textContent = config.perplexityConfigured ? '已配置' : '未配置';
  }
  if (fields.perplexityCookieState) {
    fields.perplexityCookieState.textContent = config.perplexityCookieConfigured
      ? '已配置（不显示明文）'
      : '未配置';
  }
  setStatus('已连接', 'ok');
}

async function saveConfig() {
  fields.saveHint.textContent = '保存中';
  const body = {
    searchEndpoint: fields.searchEndpoint.value.trim(),
    searchShChatEndpoint: fields.searchShEndpoint.value.trim(),
    grokApiUrl: fields.grokApiUrl.value.trim(),
    grokModel: fields.grokModel.value.trim() || 'grok-4.7,grok-4.6',
    syncGrokHfSecrets: fields.syncGrokHfSecrets?.checked ?? false,
    grokHfToken: fields.grokHfToken?.value.trim() || undefined,
    grokSystemPrompt: fields.grokSystemPrompt.value.trim() || defaultGrokSystemPrompt,
    tavilyEnabled: fields.tavilyEnabled.checked,
    tavilyProvider: getTavilyProvider(),
    tavilyApiUrl: fields.tavilyApiUrl.value.trim(),
    tavilyMcpUrl: fields.tavilyMcpUrl.value.trim(),
    tavilyMcpSearchTool: fields.tavilyMcpSearchTool.value.trim(),
    tavilyMcpExtractTool: fields.tavilyMcpExtractTool.value.trim(),
    tavilyMcpMapTool: fields.tavilyMcpMapTool.value.trim(),
    firecrawlApiUrl: fields.firecrawlApiUrl.value.trim(),
    serperApiUrl: fields.serperApiUrl?.value.trim() || '',
    exaApiUrl: fields.exaApiUrl?.value.trim() || '',
    perplexityModel: fields.perplexityModelSelect?.value.trim() || undefined,
    defaultParams: {
      categories: fields.categories.value,
      language: fields.language.value.trim() || 'auto',
      safesearch: fields.safesearch.value,
      time_range: fields.timeRange.value,
      format: 'json',
      pageno: '1'
    }
  };

  const config = await requestJson('/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  fields.keyState.textContent = config.hasSearchShApiKey ? '已配置' : '未配置';
  fields.fusionKeyState.textContent = formatFusionKeyState(config.fusion);
  renderKeyStatus(config.keyStatus || []);
  if (fields.grokHfToken) fields.grokHfToken.value = '';
  if (config.hfSync?.requested) {
    const syncedKeys = config.hfSync.updatedKeys || [];
    const failedKeys = (config.hfSync.results || []).filter((item) => !item.ok).map((item) => item.key);
    const msg = config.hfSync.ok
      ? `设置已保存，并已同步到 Hugging Face（${syncedKeys.join('、') || '完成'}）`
      : `设置已生效，但云端同步失败：${config.hfSync.error?.message || failedKeys.join(', ') || '请检查写回令牌'}`;
    fields.saveHint.textContent = msg;
    showToast(msg, config.hfSync.ok ? 'ok' : 'fail');
    setStatus(config.hfSync.ok ? '已保存并同步' : '云端未同步', config.hfSync.ok ? 'ok' : 'fail');
  } else {
    fields.saveHint.textContent = '设置已保存并立即生效';
    showToast('设置已保存并立即生效', 'ok');
    setStatus('已保存', 'ok');
  }
}

async function loadKeyStatus() {
  const payload = await requestJson('/api/admin/keys/status');
  renderKeyStatus(payload.keyStatus || []);
  if (fields.keyStatusHint) fields.keyStatusHint.textContent = 'Key 状态已刷新。改完点「保存全部」；👁 可看当前明文。';
}

// Unified key-center save: collect every filled/cleared row and push to /api/admin/keys.
// The server applies each to the running config immediately and (by default) writes it
// back to HF Secrets so a restart keeps it.
async function saveKeys() {
  const edits = [];
  $$('.key-edit-input').forEach((input) => {
    const id = input.dataset.keyId;
    if (!id) return;
    const clearBox = $(`.key-clear-box[data-key-id="${id}"]`);
    const clear = Boolean(clearBox?.checked);
    const value = input.value;
    if (clear || value.trim()) edits.push({ id, value: value.trim(), clear });
  });
  if (!edits.length) {
    if (fields.keyStatusHint) fields.keyStatusHint.textContent = '没有要改的密钥（输入框都空着）。';
    setStatus('无改动', '');
    return;
  }
  const body = {
    edits,
    writeHf: fields.keysWriteHf?.checked ?? true,
    hfToken: fields.keysHfToken?.value.trim() || undefined
  };
  const payload = await requestJson('/api/admin/keys', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (fields.keysHfToken) fields.keysHfToken.value = '';
  renderKeyStatus(payload.keyStatus || []);
  const parts = [`已保存 ${payload.changed?.length || 0} 项`];
  if (payload.hfSync?.requested) {
    parts.push(payload.hfSync.ok
      ? `已写回 HF ${payload.hfSync.updatedKeys?.length || 0} 个`
      : `HF 写回失败：${payload.hfSync.error?.message || (payload.hfSync.failedKeys || []).join(', ') || '请检查 HF_WRITE_TOKEN'}`);
  }
  if (payload.envOnlyChanged?.length) parts.push('含环境变量项，需重启 Space 生效');
  if (payload.adminRequiresLogin) parts.push('Admin 口令已改，请用新口令重新登录');
  if (fields.keyStatusHint) fields.keyStatusHint.textContent = parts.join(' · ');
  const hfFailed = payload.hfSync?.requested && !payload.hfSync.ok;
  showToast(parts.join(' · '), hfFailed ? 'fail' : 'ok');
  setStatus(hfFailed ? '云端未同步' : '密钥已保存', hfFailed ? 'fail' : 'ok');
  renderOutput({
    ok: payload.ok,
    changed: payload.changed,
    envOnlyChanged: payload.envOnlyChanged,
    adminRequiresLogin: payload.adminRequiresLogin,
    hfSync: payload.hfSync
  });
  if (payload.adminRequiresLogin) {
    await refreshSession();
  } else {
    await loadConfig().catch(() => {});
  }
}

// Session-only action from the slimmed 安全 panel: rotate the session secret (kick all
// old logins). Reuses the same unified endpoint with no key edits.
async function rotateSession() {
  if (fields.securityHint) fields.securityHint.textContent = '正在重置全部会话…';
  const payload = await requestJson('/api/admin/keys', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      edits: [],
      rotateSessionSecret: fields.rotateSessionSecret?.checked ?? true,
      writeHf: fields.syncSecurityHfSecrets?.checked ?? true,
      hfToken: fields.securityHfToken?.value.trim() || undefined
    })
  });
  if (fields.securityHfToken) fields.securityHfToken.value = '';
  const doneMsg = payload.adminRequiresLogin ? '全部会话已重置，请重新输入口令登录' : '会话密钥已重置';
  if (fields.securityHint) fields.securityHint.textContent = doneMsg;
  showToast(doneMsg, 'ok');
  renderOutput({ ok: payload.ok, adminRequiresLogin: payload.adminRequiresLogin, hfSync: payload.hfSync });
  setStatus('会话已重置', 'ok');
  if (payload.adminRequiresLogin) await refreshSession();
}

async function loadMonitoring() {
  const payload = await requestJson('/api/admin/monitoring');
  renderMonitoring(payload);
  setStatus(payload.counts?.down ? `${payload.counts.down} 项异常` : '监控正常', payload.counts?.down ? 'fail' : 'ok');
}

async function probeMonitoring() {
  if (fields.monitoringHint) fields.monitoringHint.textContent = '正在执行一键体检，请稍候…';
  const payload = await requestJson('/api/admin/monitoring/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  renderMonitoring(payload);
  renderOutput(payload);
  const msg = payload.probe?.skipped
    ? payload.probe.reason
    : `体检完成：正常 ${payload.counts?.up || 0}，异常 ${payload.counts?.down || 0}`;
  showToast(msg, payload.counts?.down ? 'fail' : 'ok');
  setStatus(payload.probe?.skipped ? '体检冷却中' : '体检完成', payload.counts?.down ? 'fail' : 'ok');
}

async function checkRuntime() {
  const [status, health] = await Promise.all([
    requestJson('/status'),
    requestJson('/health')
  ]);
  fields.mcpEndpoint.textContent = status.mcpEndpoint || '/mcp';
  fields.healthState.textContent = health.status || '-';
  setStatus('运行中', 'ok');
}

async function testSearch() {
  renderOutput('LibreSearch 测试中...');
  const payload = await requestJson('/api/admin/test/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: fields.testQuery.value.trim() || 'test',
      categories: fields.categories.value,
      language: fields.language.value.trim() || 'auto',
      safesearch: fields.safesearch.value,
      time_range: fields.timeRange.value || undefined
    })
  });
  renderOutput(payload.ok ? payload.summary : payload.error);
  setStatus(payload.ok ? '搜索正常' : '搜索异常', payload.ok ? 'ok' : 'fail');
}

async function testSearchSh() {
  renderOutput('Search-2api 测试中...');
  const payload = await requestJson('/api/admin/test/search-sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: fields.testPrompt.value.trim() || 'test'
    })
  });
  renderOutput(payload.ok ? (payload.answer || payload.payload) : payload.error);
  setStatus(payload.ok ? 'Chat 正常' : 'Chat 异常', payload.ok ? 'ok' : 'fail');
}

async function auditSearch2api() {
  renderOutput('Search-2api 维护检查中...');
  if (fields.search2apiStatusHint) fields.search2apiStatusHint.textContent = '检查中';
  const payload = await requestJson('/api/admin/test/search2api-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (fields.search2apiUpstreamState) {
    fields.search2apiUpstreamState.textContent = payload.upstream?.stale
      ? `偏旧：${payload.upstream.ageDays} 天`
      : (payload.upstream?.ok ? '可访问' : '异常');
  }
  if (fields.search2apiRuntimeState) {
    fields.search2apiRuntimeState.textContent = payload.runtime?.ok ? '接口可访问' : '需要维修';
  }
  if (fields.search2apiStatusHint) {
    fields.search2apiStatusHint.textContent = payload.ok ? '检查通过' : '需要处理';
  }
  renderOutput(payload);
  setStatus(payload.ok ? '2api 正常' : '2api 需维修', payload.ok ? 'ok' : 'fail');
}

async function loadLogs() {
  if (!fields.logViewer) return;
  fields.logViewer.innerHTML = '<div class="empty-note">读取中</div>';
  const params = new URLSearchParams({
    limit: fields.logLimit?.value || '120'
  });
  if (fields.logLevel?.value) params.set('level', fields.logLevel.value);
  if (fields.logScope?.value.trim()) params.set('scope', fields.logScope.value.trim());

  const payload = await requestJson(`/api/admin/logs?${params.toString()}`);
  if (fields.logFilePath) fields.logFilePath.textContent = payload.logFilePath || '-';
  if (fields.logCount) fields.logCount.textContent = String(payload.count ?? 0);
  fields.logViewer.innerHTML = (payload.entries || []).length
    ? payload.entries.map(renderLogEntry).join('')
    : '<div class="empty-note">暂无日志</div>';
  setStatus('日志已刷新', 'ok');
}

function renderLogEntry(entry) {
  const details = entry.details && Object.keys(entry.details).length
    ? `<pre>${escapeHtml(JSON.stringify(entry.details, null, 2))}</pre>`
    : '';
  return `
    <article class="log-entry ${escapeHtml(entry.level || 'info')}">
      <div class="log-entry-head">
        <span>${escapeHtml(entry.level || 'info')}</span>
        <strong>${escapeHtml(entry.scope || 'app')}</strong>
        <time>${escapeHtml(formatLogTime(entry.ts))}</time>
      </div>
      <p>${escapeHtml(entry.message || '')}</p>
      ${details}
    </article>
  `;
}

function formatLogTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function testGrok() {
  if (fields.grokInlineHint) fields.grokInlineHint.textContent = '正在实测 Grok 连接与回答…';
  renderOutput('Grok 实测中…');
  const payload = await requestJson('/api/admin/test/grok', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: fields.testGrokQuery.value.trim() || '一句话确认 Grok 连通正常',
      model: fields.grokModel.value.trim() || undefined,
      extraSources: 2
    })
  });
  const msg = payload.ok
    ? `Grok 测试通过（使用模型：${payload.model || getCurrentGrokModel()}）`
    : `Grok 测试失败：${payload.error?.message || '请检查地址或密钥'}`;
  if (fields.grokInlineHint) fields.grokInlineHint.textContent = msg;
  if (currentGroup !== 'tests') showToast(msg, payload.ok ? 'ok' : 'fail');
  renderOutput(payload.ok ? payload : payload.error);
  setStatus(payload.ok ? 'Grok 正常' : 'Grok 异常', payload.ok ? 'ok' : 'fail');
}

async function testTavilySearch() {
  renderOutput('Tavily Search 测试中...');
  const payload = await requestJson('/api/admin/test/tavily-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: fields.testTavilyQuery.value.trim() || 'test',
      maxResults: 5
    })
  });
  renderOutput(payload.ok ? payload : payload.error);
  setStatus(payload.ok ? 'Tavily Search 正常' : 'Tavily Search 异常', payload.ok ? 'ok' : 'fail');
}

async function testTavilyFetch() {
  renderOutput('Tavily Fetch 测试中...');
  const payload = await requestJson('/api/admin/test/tavily-fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: fields.testFetchUrl.value.trim()
    })
  });
  renderOutput(payload.ok ? payload : payload.error);
  setStatus(payload.ok ? 'Tavily Fetch 正常' : 'Tavily Fetch 异常', payload.ok ? 'ok' : 'fail');
}

async function testFusionFetch() {
  renderOutput('融合抓取测试中...');
  const payload = await requestJson('/api/admin/test/fusion-fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: fields.testFetchUrl.value.trim()
    })
  });
  renderOutput(payload.ok ? payload : payload.error);
  setStatus(payload.ok ? 'Fallback Fetch 正常' : 'Fallback Fetch 异常', payload.ok ? 'ok' : 'fail');
}

async function testFusionMap() {
  renderOutput('站点映射测试中...');
  const payload = await requestJson('/api/admin/test/fusion-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: fields.testMapUrl.value.trim(),
      maxDepth: 1,
      maxBreadth: 20,
      limit: 30,
      timeout: 30
    })
  });
  renderOutput(payload.ok ? payload : payload.error);
  setStatus(payload.ok ? 'Map 正常' : 'Map 异常', payload.ok ? 'ok' : 'fail');
}

async function testFirecrawlFetch() {
  renderOutput('Firecrawl Scrape 测试中...');
  const payload = await requestJson('/api/admin/test/firecrawl-fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: fields.testFirecrawlUrl.value.trim()
    })
  });
  renderOutput(payload.ok ? payload : payload.error);
  setStatus(payload.ok ? 'Firecrawl 正常' : 'Firecrawl 异常', payload.ok ? 'ok' : 'fail');
}

// Populate the Perplexity model select from the server catalogue and refresh status fields.
async function loadPerplexity() {
  const payload = await requestJson('/api/admin/perplexity/models');
  if (!payload.ok || !fields.perplexityModelSelect) return;

  const currentVal = fields.perplexityModelSelect.value || 'perplexity-search';
  fields.perplexityModelSelect.innerHTML = '';
  for (const group of payload.groups || []) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const model of group.models || []) {
      const opt = document.createElement('option');
      opt.value = model.id;
      opt.textContent = model.id + (model.default ? '（默认）' : '') + (model.slowWarning ? `  ⚠ ${model.slowWarning}` : '');
      optgroup.appendChild(opt);
    }
    fields.perplexityModelSelect.appendChild(optgroup);
  }
  // Restore previously selected value if still present, else keep the first option.
  if ([...fields.perplexityModelSelect.options].some((o) => o.value === currentVal)) {
    fields.perplexityModelSelect.value = currentVal;
  }
  if (fields.perplexityModelHint) {
    fields.perplexityModelHint.textContent = '模型列表已读取，可选择后保存。';
  }
}

async function savePerplexityModel() {
  const model = fields.perplexityModelSelect?.value.trim();
  if (!model) return;
  if (fields.perplexityModelHint) fields.perplexityModelHint.textContent = '保存中';
  const config = await requestJson('/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ perplexityModel: model })
  });
  if (fields.perplexityModelHint) {
    fields.perplexityModelHint.textContent = `已保存：${config.perplexityModel || model}`;
  }
  setStatus('Perplexity 模型已保存', 'ok');
}

async function savePerplexityCookie() {
  const cookieJson = fields.perplexityCookieInput?.value.trim();
  if (!cookieJson) {
    if (fields.perplexityCookieHint) fields.perplexityCookieHint.textContent = '请先粘贴账号 Cookie JSON。';
    return;
  }
  if (fields.perplexityCookieHint) fields.perplexityCookieHint.textContent = '正在写入并热更新…';
  const payload = await requestJson('/api/admin/perplexity/cookie', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookieJson })
  });
  if (fields.perplexityCookieInput) fields.perplexityCookieInput.value = '';
  const msg = payload.ok
    ? (payload.hotReloaded
      ? `已保存 ${payload.tokenCount} 个账号并即时热更新，现在可直接测试`
      : `已保存 ${payload.tokenCount} 个账号到云端，重启服务后生效`)
    : `保存失败：${payload.error?.message || '未知错误'}`;
  if (fields.perplexityCookieHint) fields.perplexityCookieHint.textContent = msg;
  showToast(msg, payload.ok ? 'ok' : 'fail');
  if (payload.ok && fields.perplexityCookieState) {
    fields.perplexityCookieState.textContent = '已配置（不显示明文）';
  }
  setStatus(payload.ok ? 'Cookie 已保存' : 'Cookie 写入失败', payload.ok ? 'ok' : 'fail');
  renderOutput(payload);
}

async function testPerplexity() {
  if (fields.perplexityTestHint) fields.perplexityTestHint.textContent = '正在实测连通性…';
  const testsHint = $('#perplexityTestFromTestsHint');
  if (testsHint) testsHint.textContent = '正在实测连通性…';
  renderOutput('Perplexity 连通实测中…');
  const model = fields.perplexityModelSelect?.value.trim() || undefined;
  const query = fields.testPerplexityQuery?.value.trim() || 'who founded Tesla';
  const payload = await requestJson('/api/admin/test/perplexity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, query })
  });
  const hint = payload.ok
    ? `测试通过（${payload.model}，耗时 ${payload.elapsed}ms）`
    : `测试失败：${payload.error?.message || '未知错误'}`;
  if (fields.perplexityTestHint) fields.perplexityTestHint.textContent = hint;
  if (testsHint) testsHint.textContent = hint;
  if (currentGroup !== 'tests') showToast(hint, payload.ok ? 'ok' : 'fail');
  renderOutput(payload.ok ? { ok: true, model: payload.model, elapsed: payload.elapsed, snippet: payload.snippet } : payload.error);
  setStatus(payload.ok ? 'Perplexity 正常' : 'Perplexity 异常', payload.ok ? 'ok' : 'fail');
}

async function testSerper() {
  if (fields.serperTestHint) fields.serperTestHint.textContent = '测试中';
  renderOutput('Serper 连通测试中（消耗 1 credit）...');
  const query = $('#testSerperQuery')?.value.trim() || 'latest AI search news';
  const payload = await requestJson('/api/admin/test/serper', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const creditNote = payload.credits !== null && payload.credits !== undefined ? ` · ${payload.credits} credit` : '';
  const hint = payload.ok
    ? `通过 · ${payload.sourceCount} 条 · ${payload.elapsed}ms${creditNote}`
    : `失败：${payload.error?.message || '未知错误'}`;
  if (fields.serperTestHint) fields.serperTestHint.textContent = hint;
  const testsHint = $('#serperTestFromTestsHint');
  if (testsHint) testsHint.textContent = hint;
  renderOutput(payload.ok
    ? { ok: true, sourceCount: payload.sourceCount, credits: payload.credits, elapsed: payload.elapsed, answer: payload.answer, snippet: payload.snippet }
    : payload.error);
  setStatus(payload.ok ? 'Serper 正常' : 'Serper 异常', payload.ok ? 'ok' : 'fail');
}

async function testExa() {
  if (fields.exaTestHint) fields.exaTestHint.textContent = '测试中';
  renderOutput('Exa 连通测试中（约 $0.007）...');
  const query = $('#testExaQuery')?.value.trim() || 'latest AI search news';
  const payload = await requestJson('/api/admin/test/exa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const costNote = payload.costDollars !== null && payload.costDollars !== undefined ? ` · $${payload.costDollars}` : '';
  const hint = payload.ok
    ? `通过 · ${payload.sourceCount} 条 · ${payload.elapsed}ms${costNote}`
    : `失败：${payload.error?.message || '未知错误'}`;
  if (fields.exaTestHint) fields.exaTestHint.textContent = hint;
  const testsHint = $('#exaTestFromTestsHint');
  if (testsHint) testsHint.textContent = hint;
  renderOutput(payload.ok
    ? { ok: true, sourceCount: payload.sourceCount, costDollars: payload.costDollars, elapsed: payload.elapsed, snippet: payload.snippet }
    : payload.error);
  setStatus(payload.ok ? 'Exa 正常' : 'Exa 异常', payload.ok ? 'ok' : 'fail');
}

async function listGrokModels() {
  if (fields.grokInlineHint) fields.grokInlineHint.textContent = '正在拉取网关模型列表…';
  renderOutput('正在读取 Grok 网关模型列表…');
  const payload = await requestJson('/api/admin/fusion/models');
  if (payload.ok) {
    const models = normalizeModelList(payload.models || []);
    renderGrokModels(models, { source: '网关已拉取' });
    const msg = `拉取成功：共 ${models.length} 个可用模型`;
    if (fields.grokInlineHint) fields.grokInlineHint.textContent = msg;
    if (currentGroup !== 'tests') showToast(msg, 'ok');
    renderOutput({
      currentModel: getCurrentGrokModel(),
      modelCount: models.length,
      models
    });
  } else {
    renderGrokModels(grokModelOptions, { source: '读取失败' });
    const msg = `拉取模型失败：${payload.error?.message || '请检查地址或密钥'}`;
    if (fields.grokInlineHint) fields.grokInlineHint.textContent = msg;
    if (currentGroup !== 'tests') showToast(msg, 'fail');
    renderOutput(payload.error);
  }
  setStatus(payload.ok ? '模型已加载' : '模型异常', payload.ok ? 'ok' : 'fail');
}

function bindAction(selector, action) {
  const element = $(selector);
  if (!element) return;
  element.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      if (error.status === 401) {
        await refreshSession();
      }
      const errMsg = error.message || String(error);
      setStatus('操作异常', 'fail');
      showToast(`操作失败：${errMsg}`, 'fail');
      renderOutput(errMsg);
    } finally {
      button.disabled = false;
    }
  });
}

bindAction('#refreshConfig', async () => {
  await loadConfig();
  await checkRuntime();
  await hydrateActiveSubview();
  showToast('配置与状态已刷新', 'ok');
});
bindAction('#saveConfig', saveConfig);
bindAction('#loginAdmin', loginAdmin);
bindAction('#logoutAdmin', logoutAdmin);
bindAction('#checkRuntime', async () => {
  await checkRuntime();
  showToast('运行状态检查完成', 'ok');
});
bindAction('#testSearch', testSearch);
bindAction('#testSearchSh', testSearchSh);
bindAction('#auditSearch2api', auditSearch2api);
bindAction('#auditSearch2apiFromTests', auditSearch2api);
bindAction('#rotateSession', rotateSession);
bindAction('#loadLogs', loadLogs);
bindAction('#saveKeys', saveKeys);
bindAction('#refreshKeyStatus', loadKeyStatus);
bindAction('#refreshMonitoring', async () => {
  await loadMonitoring();
  showToast('健康看板已刷新', 'ok');
});
bindAction('#probeMonitoring', probeMonitoring);
bindAction('#testGrok', testGrok);
bindAction('#testGrokFromPreview', testGrok);
bindAction('#testTavilySearch', testTavilySearch);
bindAction('#testTavilyFetch', testTavilyFetch);
bindAction('#testFusionFetch', testFusionFetch);
bindAction('#testFusionMap', testFusionMap);
bindAction('#listGrokModels', listGrokModels);
bindAction('#listGrokModelsFromTests', listGrokModels);
bindAction('#testFirecrawlFetch', testFirecrawlFetch);
bindAction('#savePerplexityModel', savePerplexityModel);
bindAction('#savePerplexityCookie', savePerplexityCookie);
bindAction('#testPerplexity', testPerplexity);
bindAction('#testPerplexityFromTests', testPerplexity);
bindAction('#testSerper', testSerper);
bindAction('#testSerperFromTests', testSerper);
bindAction('#testExa', testExa);
bindAction('#testExaFromTests', testExa);
bindAction('#resetGrokPrompt', async () => {
  fields.grokSystemPrompt.value = defaultGrokSystemPrompt;
  fields.saveHint.textContent = '提示词已恢复默认，点右侧保存即可生效';
  showToast('已恢复默认提示词，记得保存', 'ok');
});

// 登录框回车直接提交
fields.adminTokenInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    fields.loginAdmin?.click();
  }
});

// 监控卡片「去测试」快捷跳转 + 顶部彩条跳转对应卡片
fields.monitoringServices?.addEventListener('click', (event) => {
  const btn = event.target.closest('.uptimer-quick-btn[data-goto-test]');
  if (!btn) return;
  setActiveRoute('tests', btn.dataset.gotoTest);
});

fields.monitorBars?.addEventListener('click', (event) => {
  const bar = event.target.closest('.monitor-bar[data-jump-service]');
  if (!bar) return;
  const card = document.getElementById(`monitor-card-${bar.dataset.jumpService}`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

fields.grokModel?.addEventListener('input', () => {
  renderGrokModels(grokModelOptions, { source: '手动输入' });
});

fields.grokModelList?.addEventListener('click', (event) => {
  const card = event.target.closest('.model-card[data-model-id]');
  if (!card) return;
  toggleGrokModel(card.dataset.modelId);
});

fields.grokChainList?.addEventListener('click', (event) => {
  const op = event.target.closest('.chain-op[data-op]');
  if (!op) return;
  const item = op.closest('.chain-item[data-idx]');
  if (!item) return;
  grokChainOp(Number(item.dataset.idx), op.dataset.op);
});

fields.tavilyProviderChoices.forEach((choice) => {
  choice.addEventListener('change', () => setTavilyProvider(choice.value));
});

mainNavItems.forEach((item) => {
  item.addEventListener('click', (event) => {
    event.preventDefault();
    const group = item.dataset.group;
    setActiveRoute(group, defaultSubviews[group]);
  });
});

subNavItems.forEach((item) => {
  item.addEventListener('click', () => {
    const group = item.closest('.subnav-group')?.dataset.subnavGroup || 'sources';
    setActiveRoute(group, item.dataset.subview);
  });
});

window.addEventListener('hashchange', () => {
  setActiveRoute(...normalizeRoute(window.location.hash), false);
});

// 先确认登录态，再渲染当前路由与拉取子页数据，避免未登录时发 401 噪音或登录后监控空白
const session = await refreshSession();
setActiveRoute(...normalizeRoute(window.location.hash), false);
if (!(session.adminAuthEnabled && !session.adminAuthenticated)) {
  await loadConfig();
  await checkRuntime();
  await hydrateActiveSubview();
}
