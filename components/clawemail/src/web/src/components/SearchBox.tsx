import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from "react";

/**
 * SmartSearch —— 带自动完成建议的搜索框（claymorphism 软 UI）。
 * 建议直接从当前邮件数据蒸馏：发件人（按频次）+ 主题 + 最近搜索。
 * 纯前端、零依赖：防抖计算建议、方向键导航、Enter 选中、ESC 关闭、命中高亮。
 * 只负责把 query 设成用户选中的值，实际过滤仍由父组件按 value 做。
 */

export type SearchItem = { subject?: string | null; from?: string | null; preview?: string | null };

type Props = {
  value: string;
  onChange: (v: string) => void;
  items: SearchItem[];
  placeholder: string;
  lang: "zh" | "en";
  storageKey?: string;
};

type Kind = "recent" | "sender" | "subject";
type Sugg = {
  key: string;
  kind: Kind;
  title: string;
  subtitle?: string;
  value: string;
  hue: "blue" | "pink" | "green" | "purple" | "muted";
  badge?: string;
};
type Group = { label: string; items: Sugg[] };

const HUES: Sugg["hue"][] = ["blue", "pink", "green", "purple"];
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function loadRecent(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

// 把命中片段拆出来高亮（大小写不敏感，只标第一处足够可读）
function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="ss-hl">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function SearchBox({ value, onChange, items, placeholder, lang, storageKey = "clawemail:search:recent" }: Props) {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [debounced, setDebounced] = useState(value);
  const [recent, setRecent] = useState<string[]>(() => loadRecent(storageKey));
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 输入防抖：建议计算滞后 140ms，避免每键重算（过滤本身仍即时）
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), 140);
    return () => window.clearTimeout(id);
  }, [value]);

  // 点击外部收起
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const groups = useMemo<Group[]>(() => {
    const q = debounced.trim().toLowerCase();
    const senderCount = new Map<string, number>();
    const subjectFirst = new Map<string, string>(); // lower -> original（保序取首见）
    for (const it of items) {
      const from = (it.from || "").trim();
      if (from) senderCount.set(from, (senderCount.get(from) || 0) + 1);
      const subj = (it.subject || "").trim();
      if (subj && !subjectFirst.has(subj.toLowerCase())) subjectFirst.set(subj.toLowerCase(), subj);
    }
    const topSender = [...senderCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const newestSubject = (items[0]?.subject || "").trim();

    const mkSender = (addr: string): Sugg => ({
      key: "s:" + addr,
      kind: "sender",
      title: addr,
      subtitle: L(`${senderCount.get(addr) || 0} 封邮件`, `${senderCount.get(addr) || 0} messages`),
      value: addr,
      hue: HUES[hashStr(addr) % HUES.length],
      badge: addr === topSender ? L("常用", "Top") : undefined
    });
    const mkSubject = (subj: string): Sugg => ({
      key: "j:" + subj,
      kind: "subject",
      title: subj,
      value: subj,
      hue: "purple",
      badge: subj === newestSubject && subj ? L("新", "New") : undefined
    });

    const out: Group[] = [];
    if (!q) {
      if (recent.length) {
        out.push({
          label: L("最近搜索", "Recent"),
          items: recent.slice(0, 5).map((r) => ({ key: "r:" + r, kind: "recent", title: r, value: r, hue: "muted" as const }))
        });
      }
      const top = [...senderCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a]) => a);
      if (top.length) out.push({ label: L("常用发件人", "Frequent senders"), items: top.map(mkSender) });
    } else {
      const senders = [...senderCount.keys()].filter((a) => a.toLowerCase().includes(q)).slice(0, 5).map(mkSender);
      if (senders.length) out.push({ label: L("发件人", "Senders"), items: senders });
      const subjects = [...subjectFirst.values()].filter((s) => s.toLowerCase().includes(q)).slice(0, 6).map(mkSubject);
      if (subjects.length) out.push({ label: L("主题", "Subjects"), items: subjects });
    }
    return out;
  }, [items, debounced, recent, lang]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (active >= flat.length) setActive(flat.length - 1);
  }, [flat.length, active]);

  function pushRecent(v: string) {
    const t = v.trim();
    if (!t) return;
    const next = [t, ...loadRecent(storageKey).filter((x) => x !== t)].slice(0, 6);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* quota — 忽略 */
    }
    setRecent(next);
  }

  function apply(s: Sugg) {
    onChange(s.value);
    pushRecent(s.value);
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
  }

  function onKey(e: RKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && active < flat.length) {
        e.preventDefault();
        apply(flat[active]);
      } else if (value.trim()) {
        pushRecent(value);
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  let idx = -1;
  return (
    <div className="smart-search" ref={rootRef}>
      <div className="ss-field">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls="ss-listbox"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="ss-aff">
          {value ? (
            <button
              type="button"
              className="ss-x"
              aria-label={L("清除", "Clear")}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange("");
                inputRef.current?.focus();
                setOpen(true);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <kbd className="ss-kbd">↓</kbd>
          )}
        </div>
      </div>

      {open && flat.length > 0 && (
        <div className="ss-panel" id="ss-listbox" role="listbox">
          {groups.map((g) => (
            <div className="ss-group" key={g.label}>
              <div className="ss-group-label">{g.label}</div>
              {g.items.map((s) => {
                idx++;
                const on = idx === active;
                const myIdx = idx;
                return (
                  <button
                    type="button"
                    key={s.key}
                    className={`ss-item ${on ? "on" : ""}`}
                    role="option"
                    aria-selected={on}
                    onMouseEnter={() => setActive(myIdx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      apply(s);
                    }}
                  >
                    <span className={`ss-ico ss-ico--${s.hue}`}>
                      {s.kind === "sender" ? (
                        (s.title[0] || "?").toUpperCase()
                      ) : s.kind === "recent" ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 7h16M4 12h16M4 17h10" />
                        </svg>
                      )}
                    </span>
                    <span className="ss-txt">
                      <span className="ss-title">{highlight(s.title, debounced.trim())}</span>
                      {s.subtitle && <span className="ss-sub">{s.subtitle}</span>}
                    </span>
                    {s.badge && <span className={`ss-badge ss-badge--${s.hue}`}>{s.badge}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="ss-hint">
            <span><kbd>↑</kbd><kbd>↓</kbd> {L("导航", "navigate")}</span>
            <span><kbd>↵</kbd> {L("选择", "select")}</span>
            <span><kbd>esc</kbd> {L("关闭", "close")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
