// 上游瞬时故障重试。
//
// 背景（实测，非拍脑袋）：edu 的 cf 壳在并发下会对 /api/parsed_mails 返回
//   {"error":"service not seeded; an admin must call /admin/new_address once first"}
// 30 并发 / 60 请求量到约 5~15% 命中；面板原来"mint 一把再读"拿不到就整条抛错，
// 出口层 sees throw → 502 给客户端，用户侧表现为"邮箱 API 瞬时故障"。
// 实测加最多 2 次重试后，同一压力下最终失败 = 0。
//
// ⚠ 只给「幂等」的读操作（读信、mint jwt、列地址）用。
//   send_mail / 发信类非幂等动作绝对不要包进来 —— 重试会重复发信。

export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

// 从错误文案判定是否值得重试。
export function isRetryableMessage(message: string): boolean {
  if (/not seeded/i.test(message)) return true;                       // edu/cf 壳的 seed 竞态
  if (/HTTP\s+(408|429|5\d\d)\b/i.test(message)) return true;      // 上游瞬时代码
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network error/i.test(message);
}

export type RetryOptions = { retries?: number; baseDelayMs?: number };

export async function retryAsync<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 150;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === retries || !isRetryableMessage(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}
