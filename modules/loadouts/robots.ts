// robots.txt：只认 User-agent 分组里的 Allow / Disallow。`*` 和 `$` 按常见写法处理。
// 没有这份文件（404，或像洲械库那样任意路径都返回网页）就当作允许。5xx 由调用方放弃这一轮。

interface Rule { allow: boolean; pattern: string }
interface Group { agents: string[]; rules: Rule[] }

export function looksLikeRobots(body: string): boolean {
  const head = body.slice(0, 1500).trimStart();
  if (/^<!doctype html/i.test(head) || /^<html/i.test(head)) return false;
  return /user-agent\s*:/i.test(head);
}

function parseRobots(body: string): Group[] {
  const groups: Group[] = [];
  let agents: string[] = [];
  let rules: Rule[] = [];
  const flush = () => {
    if (agents.length && rules.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const cleaned = line.replace(/#.*$/, "").trim();
    if (!cleaned) {
      flush();
      continue;
    }
    const match = /^([^:]+):\s*(.*)$/.exec(cleaned);
    if (!match) continue;
    const key = match[1]!.trim().toLowerCase();
    const value = match[2]!.trim();
    if (key === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length) {
      rules.push({ allow: key === "allow", pattern: value });
    }
  }
  flush();
  return groups;
}

function patternMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  if (![...pattern].some((char) => char === "*" || char === "$")) return path.startsWith(pattern);
  const anchor = pattern.endsWith("$");
  const source = anchor ? pattern.slice(0, -1) : pattern;
  const body = source.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchor ? "$" : ""}`).test(path);
}

/** 这条地址能不能抓。没有命中的 Disallow 就是可以。 */
export function robotsAllows(body: string, target: string, crawler: string): boolean {
  const groups = parseRobots(body);
  const crawlerName = crawler.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && crawlerName.includes(agent)));
  let chosen = specific;
  if (specific.length) {
    const longest = Math.max(...specific.flatMap((group) => group.agents.filter((agent) => agent !== "*" && crawlerName.includes(agent)).map((agent) => agent.length)));
    chosen = specific.filter((group) => group.agents.some((agent) => agent !== "*" && crawlerName.includes(agent) && agent.length === longest));
  } else {
    chosen = groups.filter((group) => group.agents.includes("*"));
  }
  const url = new URL(target);
  const path = `${url.pathname}${url.search}`;
  let best: { allow: boolean; score: number } | null = null;
  for (const rule of chosen.flatMap((group) => group.rules)) {
    if (!patternMatches(rule.pattern, path)) continue;
    const score = rule.pattern.length;
    if (!best || score > best.score) best = { allow: rule.allow, score };
  }
  return !best || best.allow;
}

/**
 * 200 且是 robots 正文就按规则；404 或返回的是网页（这个站没有 robots.txt）则允许。
 * 其他状态抛出，调用方记失败、这一轮不抓。
 */
export function mayFetch(status: number, body: string, target: string, crawler: string): boolean {
  if (status === 404) return true;
  if (status !== 200) throw new Error(`robots.txt HTTP ${status}`);
  if (!looksLikeRobots(body)) return true;
  return robotsAllows(body, target, crawler);
}
