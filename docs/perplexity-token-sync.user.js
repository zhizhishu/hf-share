// ==UserScript==
// @name         FusionSearch · Perplexity Token 自动同步
// @namespace    fusionsearch
// @version      1.0
// @description  浏览 perplexity.ai 时自动把登录 cookie 同步给 FusionSearch，第6源 cookie 续期全自动。
// @author       糯米酱
// @match        https://www.perplexity.ai/*
// @match        https://perplexity.ai/*
// @grant        GM_cookie
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      alphaeee-claw.hf.space
// @run-at       document-idle
// ==/UserScript==

/*
 * 一次性配置：
 *   1. 浏览器装 Tampermonkey(油猴)扩展。
 *   2. 新建脚本，把本文件全部内容粘进去。
 *   3. 改下面两个常量：SYNC_URL(你的 fusion 域 + /api/perplexity/sync-token) 和
 *      SYNC_TOKEN(跟 HF 变量 PERPLEXITY_SYNC_TOKEN 一模一样)。
 *   4. 保存。以后正常登录/使用 perplexity.ai，脚本自动把最新 cookie 送给 fusion。
 *
 * 实测依据(2026-07-11 jshook 验尸)：session-token 和 csrf-token 都是 httpOnly，
 *   所以 document.cookie 读不到，必须用 Tampermonkey 的特权 GM_cookie。cf_clearance/__cf_bm
 *   是 Cloudflare 的、服务端不用(curl_cffi 指纹伪装过 CF)，这里也不采集。
 * 隐私：cookie 只发往你自己的 fusion 域(见 @connect 白名单)，别处发不出去。
 */

(function () {
  'use strict';

  // ====== 改这两处 ======
  const SYNC_URL = 'https://alphaeee-claw.hf.space/api/perplexity/sync-token';
  const SYNC_TOKEN = 'REPLACE_WITH_YOUR_PERPLEXITY_SYNC_TOKEN';
  // ======================

  const SESSION_COOKIE = '__Secure-next-auth.session-token';
  const CSRF_COOKIE = 'next-auth.csrf-token';
  const LAST_ACCOUNT_COOKIE = '__Host-pplx-last-active-account';
  const TOKEN_ID = 'primary';
  const RESYNC_INTERVAL_MS = 30 * 60 * 1000; // 每 30 分钟复查一次

  // 读取所有当前站点 Cookie（含 httpOnly 与新版滚动 __Secure-pplx.session.<uuid>）。
  function listAllCookies() {
    return new Promise((resolve) => {
      try {
        GM_cookie.list({}, (cookies, err) => {
          if (err || !Array.isArray(cookies)) return resolve([]);
          resolve(cookies);
        });
      } catch (e) {
        resolve([]);
      }
    });
  }

  function pickLongest(list, name) {
    const matches = list.filter((c) => c.name === name && c.value);
    if (!matches.length) return '';
    return matches.map((c) => c.value).sort((a, b) => b.length - a.length)[0] || '';
  }

  async function sync() {
    if (SYNC_TOKEN === 'REPLACE_WITH_YOUR_PERPLEXITY_SYNC_TOKEN') {
      console.warn('[fs-sync] 还没填 SYNC_TOKEN，先去脚本里改一下');
      return;
    }
    const all = await listAllCookies();
    const session = pickLongest(all, SESSION_COOKIE);
    const csrf = pickLongest(all, CSRF_COOKIE);
    const extraCookies = {};
    const lastAccount = pickLongest(all, LAST_ACCOUNT_COOKIE);
    if (lastAccount) extraCookies[LAST_ACCOUNT_COOKIE] = lastAccount;
    for (const c of all) {
      if (c.name && c.name.startsWith('__Secure-pplx.session.') && c.value) {
        if (!extraCookies[c.name] || c.value.length > extraCookies[c.name].length) {
          extraCookies[c.name] = c.value;
        }
      }
    }
    const hasLegacy = Boolean(session && csrf);
    const hasRolling = Object.keys(extraCookies).some((k) => k.startsWith('__Secure-pplx.session.'));
    if (!hasLegacy && !hasRolling) {
      console.log('[fs-sync] 登录 Cookie 未就绪(可能还没登录 Perplexity)');
      return;
    }
    // 去重：token 没变就不重复上报。
    const extraFp = Object.entries(extraCookies)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => k + '=' + v.slice(-16))
      .join('&');
    const fingerprint = session.slice(-24) + '|' + csrf.slice(-24) + '|' + extraFp;
    if (GM_getValue('fs_last_fp', '') === fingerprint) {
      console.log('[fs-sync] token 未变化，跳过');
      return;
    }
    const body = { id: TOKEN_ID, session_token: session, csrf_token: csrf };
    if (Object.keys(extraCookies).length) body.cookies = extraCookies;
    GM_xmlhttpRequest({
      method: 'POST',
      url: SYNC_URL,
      headers: { 'Content-Type': 'application/json', 'X-Sync-Token': SYNC_TOKEN },
      data: JSON.stringify(body),
      timeout: 20000,
      onload: (resp) => {
        if (resp.status === 200) {
          GM_setValue('fs_last_fp', fingerprint);
          let note = '';
          try { note = JSON.parse(resp.responseText).note || ''; } catch (e) {}
          console.log('[fs-sync] cookie 已同步给 FusionSearch', note);
        } else {
          console.warn('[fs-sync] 同步失败 HTTP', resp.status, resp.responseText);
        }
      },
      onerror: (e) => console.warn('[fs-sync] 同步请求出错', e),
      ontimeout: () => console.warn('[fs-sync] 同步超时'),
    });
  }

  // 进页面 3 秒后同步一次(等登录态就绪) + 之后每 30 分钟复查。
  setTimeout(sync, 3000);
  setInterval(sync, RESYNC_INTERVAL_MS);
})();
