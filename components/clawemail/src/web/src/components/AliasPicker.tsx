import { useEffect, useMemo, useRef, useState } from "react";

/**
 * AliasPicker —— 可搜索的别名选择器。
 * 原生 <select> 在别名几十个时只能肉眼逐个找；这里换成输入即过滤的组合框。
 * 匹配策略：子串命中优先（越靠前分越高），否则退化为「子序列模糊匹配」，
 * 所以输入 p1 / prb1 / probe 都能命中 probe1@edu.002836.xyz。
 */

type Alias = { local: string; address: string };

type Props = {
  aliases: Alias[];
  value: string;
  onChange: (local: string) => void;
  lang: "zh" | "en";
};

function fuzzyScore(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct;
  let cursor = 0;
  let score = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, cursor);
    if (idx < 0) return -1;
    score += 100 - Math.min(idx - cursor, 90);
    cursor = idx + 1;
  }
  return score;
}

export function AliasPicker({ aliases, value, onChange, lang }: Props) {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedAddress = useMemo(
    () => aliases.find((a) => a.local === value)?.address ?? "",
    [aliases, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return aliases;
    return aliases
      .map((a) => ({ a, score: fuzzyScore(a.address, q) }))
      .filter((x) => x.score >= 0)
      .sort((x, y) => y.score - x.score)
      .map((x) => x.a);
  }, [aliases, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (active >= filtered.length) setActive(filtered.length - 1);
  }, [filtered.length, active]);

  function pick(local: string) {
    onChange(local);
    setOpen(false);
    setQuery("");
    setActive(-1);
    inputRef.current?.blur();
  }

  const shown = open ? query : selectedAddress;

  return (
    <div className="alias-picker" ref={rootRef}>
      <div className="ap-field">
        <input
          ref={inputRef}
          value={shown}
          placeholder={L("搜索别名…", "search alias…")}
          role="combobox"
          aria-expanded={open}
          aria-controls="ap-listbox"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setActive(-1);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) setOpen(true);
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              if (open && active >= 0 && active < filtered.length) {
                e.preventDefault();
                pick(filtered[active].local);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
              setQuery("");
              setActive(-1);
            }
          }}
        />
        <span className="ap-count mono">{filtered.length}</span>
      </div>

      {open && (
        <div className="ap-panel" id="ap-listbox" role="listbox">
          {filtered.length === 0 ? (
            <div className="ap-empty">{L("没有匹配的别名", "no matching alias")}</div>
          ) : (
            filtered.map((a, i) => (
              <button
                type="button"
                key={a.local}
                role="option"
                aria-selected={a.local === value}
                className={`ap-item ${i === active ? "on" : ""} ${a.local === value ? "cur" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(a.local);
                }}
              >
                <span className="ap-addr mono">{a.address}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
