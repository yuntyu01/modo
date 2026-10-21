/**
 * 글 꾸미기: 굵게 · 밑줄 · 취소선 · 링크(사용자 요청 2026-10-21).
 *
 * 저장은 예전 text 칸 그대로이고, 꾸민 부분만 짧은 태그로 감싼다.
 *   <b>굵게</b>  <u>밑줄</u>  <s>취소선</s>  <a href="https://…">링크</a>
 * - 꾸미지 않은 글은 예전과 한 글자도 다르지 않다(DB·동기화 형식·서버는 그대로).
 * - 글 속의 '<'·'&'는 태그나 &lt; &amp;로 읽힐 수 있을 때만 &lt; &amp;로 적어 둔다(그 밖의 글자는 그대로).
 *   마크다운(**·~~)은 한국어 글에 흔한 '~~'와 겹쳐 쓰지 않았다.
 * - 안드로이드 위젯(Rich.kt)·iOS 위젯(NotesStore.swift)도 같은 규칙으로 읽는다.
 * - 화면의 커서·선택 위치는 모두 태그를 뺀 글(plain) 기준이다.
 */

export type Mark = 'b' | 'u' | 's';
/** 같은 꾸밈이 이어진 글 조각 */
export type Run = { text: string; b?: boolean; u?: boolean; s?: boolean; href?: string };

const TOKEN = /<(\/?)([bus])>|<a href="([^"<>]*)">|<\/a>|&(lt|amp);/g;
const TAG_AT = /<\/?[bus]>|<a href="[^"<>]*">|<\/a>/y;

/** 열 수 있는 주소만 링크로 둔다(javascript: 같은 것은 글자만 남긴다) */
export function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : null;
}

/** 사람이 넣은 주소를 링크 주소로. 'naver.com'처럼 앞부분이 없으면 https://를 붙인다. 주소가 아니면 null */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  let url: string;
  if (/^[a-z][\w+.-]*:\/\//i.test(s) || /^(mailto|tel):/i.test(s)) {
    if (!safeHref(s) || /^https?:\/\/$/i.test(s)) return null;
    url = s;
  } else {
    // 도메인처럼 생겼을 때만(점으로 나뉜 이름, 끝 이름은 숫자만이 아닌 두 글자 이상): 'naver.com', 'www.a.co.kr/x'
    const host = s.split(/[/?#]/)[0].replace(/:\d+$/, '');
    const labels = host.split('.');
    const tld = labels[labels.length - 1];
    if (labels.length < 2 || labels.some((l) => !l || /[:@]/.test(l)) || tld.length < 2 || /^\d+$/.test(tld)) return null;
    url = `https://${s}`;
  }
  // 태그 안에 넣을 수 없는 글자만 바꿔 적는다
  return url.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
}

const sameMarks = (a: Run, b: Run) => !!a.b === !!b.b && !!a.u === !!b.u && !!a.s === !!b.s && (a.href ?? '') === (b.href ?? '');

function marksOf(r: Run | undefined): Omit<Run, 'text'> {
  if (!r) return {};
  const m: Omit<Run, 'text'> = {};
  if (r.b) m.b = true;
  if (r.u) m.u = true;
  if (r.s) m.s = true;
  if (r.href) m.href = r.href;
  return m;
}

/** 빈 조각을 빼고 꾸밈이 같은 이웃 조각을 합친다 */
export function normalizeRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, r)) last.text += r.text;
    else out.push({ ...marksOf(r), text: r.text });
  }
  return out;
}

export function parseRich(src: string): Run[] {
  if (!src) return [];
  if (src.indexOf('<') < 0 && src.indexOf('&') < 0) return [{ text: src }];
  const out: Run[] = [];
  const depth = { b: 0, u: 0, s: 0 };
  // 링크 안의 링크는 없지만, 허락하지 않는 주소('')도 닫는 태그와 짝을 맞추려고 쌓아 둔다
  const links: string[] = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const r: Run = { text: buf };
    if (depth.b) r.b = true;
    if (depth.u) r.u = true;
    if (depth.s) r.s = true;
    const href = links[links.length - 1];
    if (href) r.href = href;
    out.push(r);
    buf = '';
  };
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(src); m; m = TOKEN.exec(src)) {
    buf += src.slice(last, m.index);
    last = TOKEN.lastIndex;
    const [all, close, mark, href, ent] = m;
    if (ent) buf += ent === 'lt' ? '<' : '&';
    else if (mark) {
      const k = mark as Mark;
      if (!close) {
        flush();
        depth[k]++;
      } else if (depth[k]) {
        flush();
        depth[k]--;
      } else buf += all;
    } else if (href !== undefined) {
      flush();
      links.push(safeHref(href) ?? '');
    } else if (links.length) {
      flush();
      links.pop();
    } else buf += all;
  }
  buf += src.slice(last);
  flush();
  return normalizeRuns(out);
}

function escapeText(t: string) {
  if (t.indexOf('<') < 0 && t.indexOf('&') < 0) return t;
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '<') {
      TAG_AT.lastIndex = i;
      out += TAG_AT.test(t) ? '&lt;' : c;
    } else if (c === '&' && (t.startsWith('lt;', i + 1) || t.startsWith('amp;', i + 1))) out += '&amp;';
    else out += c;
  }
  return out;
}

/** 꾸미지 않은 글(입력창·빠른 추가)을 저장할 글로: 태그처럼 읽힐 글자만 바꿔 적는다 */
export const escapePlain = escapeText;

type Open = { k: 'a' | Mark; href?: string };
const ORDER: ('a' | Mark)[] = ['a', 'b', 'u', 's'];

export function serializeRich(runs: Run[]): string {
  let out = '';
  const stack: Open[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const wanted = (e: Open) => (e.k === 'a' ? !!r.href && r.href === e.href : !!r[e.k]);
    let keep = 0;
    while (keep < stack.length && wanted(stack[keep])) keep++;
    while (stack.length > keep) out += `</${stack.pop()!.k}>`;
    for (const k of ORDER) {
      const has = k === 'a' ? !!r.href : !!r[k];
      if (!has || stack.some((e) => e.k === k)) continue;
      stack.push(k === 'a' ? { k, href: r.href } : { k });
      out += k === 'a' ? `<a href="${r.href}">` : `<${k}>`;
    }
    out += escapeText(r.text);
  }
  while (stack.length) out += `</${stack.pop()!.k}>`;
  return out;
}

export const plainOf = (runs: Run[]) => runs.map((r) => r.text).join('');

/** 저장된 글에서 태그를 뺀 글(검색·알림·말풍선·글자 수) */
export function toPlain(src: string): string {
  if (!src || (src.indexOf('<') < 0 && src.indexOf('&') < 0)) return src;
  return plainOf(parseRich(src));
}

/** 바깥으로 보내는 글(공유·복사): 태그를 빼고, 링크는 '글 (주소)'로 주소를 남긴다 */
export function toShareText(src: string): string {
  if (!src || (src.indexOf('<') < 0 && src.indexOf('&') < 0)) return src;
  const runs = parseRich(src);
  let out = '';
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    out += r.text;
    // 같은 링크가 꾸밈만 달라 여러 조각으로 나뉘었으면 마지막 조각 뒤에 한 번
    if (r.href && runs[i + 1]?.href !== r.href) {
      let j = i;
      let label = '';
      while (j >= 0 && runs[j].href === r.href) label = runs[j--].text + label;
      if (label.trim() !== r.href && `https://${label.trim()}` !== r.href) out += ` (${r.href})`;
    }
  }
  return out;
}

/** 꾸민 데가 있는지 */
export const isRich = (src: string) => parseRich(src).some((r) => r.b || r.u || r.s || r.href);

export function sliceRuns(runs: Run[], start: number, end: number): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const r of runs) {
    const a = Math.max(start, at);
    const b = Math.min(end, at + r.text.length);
    if (a < b) out.push({ ...marksOf(r), text: r.text.slice(a - at, b - at) });
    at += r.text.length;
    if (at >= end) break;
  }
  return out;
}

/** plain 위치 i의 글자가 든 조각(없으면 undefined) */
function runAt(runs: Run[], i: number): Run | undefined {
  if (i < 0) return undefined;
  let at = 0;
  for (const r of runs) {
    if (i < at + r.text.length) return r;
    at += r.text.length;
  }
  return undefined;
}

/**
 * 위치 at에 새로 쓰는 글자의 꾸밈: 굵게·밑줄·취소선은 앞 글자를 따른다(맨 앞이면 뒤 글자).
 * 링크는 링크 한가운데일 때만 이어진다(링크 끝에 이어 쓴 글은 링크가 아니다).
 */
export function marksForInsert(runs: Run[], at: number): Omit<Run, 'text'> {
  const left = runAt(runs, at - 1);
  const right = runAt(runs, at);
  const m = marksOf(left ?? right);
  delete m.href;
  if (left?.href && left.href === right?.href) m.href = left.href;
  return m;
}

/** [start, end)를 text로 바꾼다. 고른 글 위에 쓰면 고른 글 첫 글자의 꾸밈을, 아니면 marksForInsert를 따른다 */
export function replaceRange(runs: Run[], start: number, end: number, text: string): Run[] {
  const marks = end > start ? marksOf(runAt(runs, start)) : marksForInsert(runs, start);
  const total = plainOf(runs).length;
  return normalizeRuns([...sliceRuns(runs, 0, start), { ...marks, text }, ...sliceRuns(runs, end, total)]);
}

/**
 * 입력창이 알려 준 새 글(plain)을 꾸밈에 반영한다. 바뀐 자리는 바뀌기 전 선택(sel)과 맞으면 그 자리로,
 * 아니면 앞뒤로 같은 글자를 빼고 남은 곳으로 본다.
 */
export function applyPlainEdit(runs: Run[], next: string, sel?: { start: number; end: number }): Run[] {
  const prev = plainOf(runs);
  if (prev === next) return runs;
  if (sel) {
    const s = Math.min(sel.start, sel.end);
    const e = Math.max(sel.start, sel.end);
    const tail = prev.length - e;
    const insLen = next.length - s - tail;
    if (e <= prev.length && insLen >= 0 && next.startsWith(prev.slice(0, s)) && next.endsWith(prev.slice(e)) && (insLen > 0 || e > s)) {
      return replaceRange(runs, s, e, next.slice(s, s + insLen));
    }
  }
  let p = 0;
  const max = Math.min(prev.length, next.length);
  while (p < max && prev[p] === next[p]) p++;
  let q = 0;
  while (q < max - p && prev[prev.length - 1 - q] === next[next.length - 1 - q]) q++;
  return replaceRange(runs, p, prev.length - q, next.slice(p, next.length - q));
}

const hasMark = (r: Run, k: Mark | 'a') => (k === 'a' ? !!r.href : !!r[k]);

/** 고른 글이 모두 그 꾸밈인지(꾸밈 막대 단추를 눌린 모양으로) */
export function allMarked(runs: Run[], start: number, end: number, k: Mark | 'a'): boolean {
  const mid = sliceRuns(runs, start, end);
  return mid.length > 0 && mid.every((r) => hasMark(r, k));
}

/** 고른 글의 링크 주소(모두 같은 링크일 때만) */
export function linkOf(runs: Run[], start: number, end: number): string | null {
  const mid = sliceRuns(runs, start, end);
  const h = mid[0]?.href;
  return h && mid.every((r) => r.href === h) ? h : null;
}

/** 고른 글에 꾸밈을 켜고 끈다: 모두 켜져 있으면 끄고, 아니면 모두 켠다 */
export function toggleMark(runs: Run[], start: number, end: number, k: Mark): Run[] {
  if (end <= start) return runs;
  const on = !allMarked(runs, start, end, k);
  const total = plainOf(runs).length;
  const mid = sliceRuns(runs, start, end).map((r) => {
    const x = { ...r };
    if (on) x[k] = true;
    else delete x[k];
    return x;
  });
  return normalizeRuns([...sliceRuns(runs, 0, start), ...mid, ...sliceRuns(runs, end, total)]);
}

/** 고른 글을 링크로(href = null이면 링크 빼기) */
export function setLink(runs: Run[], start: number, end: number, href: string | null): Run[] {
  if (end <= start) return runs;
  const total = plainOf(runs).length;
  const mid = sliceRuns(runs, start, end).map((r) => {
    const x = { ...r };
    if (href) x.href = href;
    else delete x.href;
    return x;
  });
  return normalizeRuns([...sliceRuns(runs, 0, start), ...mid, ...sliceRuns(runs, end, total)]);
}

/** 줄바꿈으로 나눈다(메모 문단 나누기) */
export function splitRunsByLine(runs: Run[]): Run[][] {
  const out: Run[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((t, i) => {
      if (i > 0) out.push([]);
      if (t) out[out.length - 1].push({ ...marksOf(r), text: t });
    });
  }
  return out.map(normalizeRuns);
}

const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

/** 주소처럼 생긴 글(https://…, www.…)도 보여 줄 때는 링크로(저장은 그대로) */
export function linkifyRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (r.href || (r.text.indexOf('://') < 0 && !/www\./i.test(r.text))) {
      out.push(r);
      continue;
    }
    let last = 0;
    BARE_URL.lastIndex = 0;
    for (let m = BARE_URL.exec(r.text); m; m = BARE_URL.exec(r.text)) {
      let url = m[0];
      // 문장 끝 문장부호·닫는 괄호는 주소가 아니다(주소 안에서 짝이 맞는 괄호는 둔다)
      while (/[.,;:!?'"’”…)\]}>]$/.test(url)) {
        if (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
        url = url.slice(0, -1);
      }
      const href = normalizeUrl(url);
      if (!href) continue;
      if (m.index > last) out.push({ ...marksOf(r), text: r.text.slice(last, m.index) });
      out.push({ ...marksOf(r), text: url, href });
      last = m.index + url.length;
      BARE_URL.lastIndex = last;
    }
    if (last < r.text.length) out.push({ ...marksOf(r), text: r.text.slice(last) });
  }
  return out;
}

/** 링크 주소를 보기 좋게(앞의 https://와 끝 / 빼기) */
export function displayUrl(href: string): string {
  return href.replace(/^https?:\/\//i, '').replace(/^mailto:/i, '').replace(/\/$/, '');
}
