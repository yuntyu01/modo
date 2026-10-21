import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Text as RNText, View } from 'react-native';

import {
  allMarked,
  applyPlainEdit,
  linkOf,
  normalizeRuns,
  normalizeUrl,
  parseRich,
  plainOf,
  replaceRange,
  serializeRich,
  setLink,
  sliceRuns,
  splitRunsByLine,
  toggleMark,
  toPlain,
  type Mark,
  type Run,
} from '../core/rich';
import { useUi } from '../state/AppContext';
import { deepAccent } from './color';
import type { RichEditorProps } from './richEditorProps';
import { linkColor } from './RichText';

/**
 * PC 입력칸: 읽을 때와 같은 글(Text)을 그 자리에서 고칠 수 있게(contentEditable) 해서 꾸민 글을 그대로 보여 주며 고친다.
 * - 글자를 끌어 고르면 그 위에 꾸미기 막대(굵게 · 밑줄 · 취소선 · 링크).
 * - Ctrl+B 굵게 · Ctrl+U 밑줄 · Ctrl+Shift+X(또는 S) 취소선 · Ctrl+K 링크, 고른 글 위에 주소를 Ctrl+V 하면 링크.
 * - 글자는 브라우저가 고친 화면에서 읽어 꾸밈(모델)에 반영하고, 화면이 모델과 다를 때만(링크 끝에 이어 쓴 글 등) 다시 그린다.
 *   한글 조합 중에는 화면을 건드리지 않는다.
 * - 붙여 넣기는 글자만(서식 없이). 되돌리기(Ctrl+Z)·다시 하기(Ctrl+Y)는 이 칸이 직접 기억한다.
 */
type Sel = { start: number; end: number };
type Snap = { runs: Run[]; sel: Sel | null };
type Active = { b: boolean; u: boolean; s: boolean; a: boolean };
type Bar = { sel: Sel; rect: { top: number; bottom: number; left: number; right: number }; active?: Active };

const clean = (s: string) => s.replace(/ /g, ' ');

function texts(root: Node): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}
const readPlain = (root: HTMLElement) => clean(texts(root).map((t) => t.data).join(''));

/** 화면에 지금 보이는 꾸밈(브라우저가 글자를 어느 조각에 넣었는지) */
function readRuns(root: HTMLElement): Run[] {
  return normalizeRuns(
    texts(root).map((t) => {
      const r: Run = { text: clean(t.data) };
      for (let el = t.parentElement; el && el !== root; el = el.parentElement) {
        const d = el.dataset;
        if (d.b) r.b = true;
        if (d.u) r.u = true;
        if (d.s) r.s = true;
        if (d.href && !r.href) r.href = d.href;
      }
      return r;
    }),
  );
}

function offsetIn(root: HTMLElement, node: Node, off: number) {
  const r = document.createRange();
  r.setStart(root, 0);
  r.setEnd(node, off);
  return r.toString().length;
}

function getSel(root: HTMLElement): Sel | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  return { start: offsetIn(root, r.startContainer, r.startOffset), end: offsetIn(root, r.endContainer, r.endOffset) };
}

const inLink = (t: Node) => !!(t.parentElement as HTMLElement | null)?.closest?.('[data-href]');

/** plain 위치 → 글자 노드 안의 자리. 조각 경계에서는 앞 조각(링크 끝이면 뒤 조각: 이어 쓴 글이 링크로 들어가지 않게) */
function pointAt(root: HTMLElement, off: number): [Node, number] {
  const nodes = texts(root);
  for (let i = 0; i < nodes.length; i++) {
    const len = nodes[i].data.length;
    if (off < len || (off === len && !(nodes[i + 1] && inLink(nodes[i])))) return [nodes[i], off];
    off -= len;
  }
  return [root, root.childNodes.length];
}

function setSel(root: HTMLElement, start: number, end: number) {
  const s = window.getSelection();
  if (!s) return;
  const r = document.createRange();
  const [a, ao] = pointAt(root, start);
  const [b, bo] = start === end ? [a, ao] : pointAt(root, end);
  r.setStart(a, ao);
  r.setEnd(b, bo);
  s.removeAllRanges();
  s.addRange(r);
}

function render(root: HTMLElement, runs: Run[], link: string) {
  root.textContent = '';
  for (const r of runs) {
    if (!r.b && !r.u && !r.s && !r.href) {
      root.appendChild(document.createTextNode(r.text));
      continue;
    }
    const el = document.createElement('span');
    if (r.b) {
      el.dataset.b = '1';
      el.style.fontWeight = '700';
    }
    if (r.u) el.dataset.u = '1';
    if (r.s) el.dataset.s = '1';
    const deco = [r.u || r.href ? 'underline' : '', r.s ? 'line-through' : ''].filter(Boolean).join(' ');
    if (deco) el.style.textDecorationLine = deco;
    if (r.href) {
      el.dataset.href = r.href;
      el.style.color = link;
    }
    el.textContent = r.text;
    root.appendChild(el);
  }
}

const sameRuns = (a: Run[], b: Run[]) => serializeRich(a) === serializeRich(b);

/** 이어 치는 글자는 1초 안이면 되돌리기 한 번에 묶는다 */
const TYPE_GROUP_MS = 1000;
const BAR_H = 36;
const BAR_W = 146;

export function RichEditor(p: RichEditorProps) {
  const { theme, t, showToast } = useUi();
  const ref = useRef<HTMLElement | null>(null);
  const runs = useRef<Run[]>(parseRich(p.initial));
  const props = useRef(p);
  useLayoutEffect(() => {
    props.current = p;
  });
  const before = useRef<Sel | null>(null);
  const composing = useRef(false);
  const alive = useRef(false);
  const dragging = useRef(false);
  const history = useRef<{ undo: Snap[]; redo: Snap[]; lastType: number }>({ undo: [], redo: [], lastType: 0 });
  const [bar, setBar] = useState<Bar | null>(null);
  const [linking, setLinkingState] = useState<(Bar & { href: string }) | null>(null);
  const linkingRef = useRef(linking);
  const setLinking = (v: (Bar & { href: string }) | null) => {
    linkingRef.current = v;
    setLinkingState(v);
  };
  const barEl = useRef<HTMLDivElement | null>(null);
  const linkInput = useRef<HTMLInputElement | null>(null);
  const [empty, setEmpty] = useState(() => !toPlain(p.initial));
  const link = linkColor(theme);
  const linkRef = useRef(link);
  useLayoutEffect(() => {
    linkRef.current = link;
  });

  const el = () => ref.current!;

  const remember = (kind: 'type' | 'edit', sel: Sel | null) => {
    const h = history.current;
    const now = Date.now();
    if (kind === 'type' && now - h.lastType < TYPE_GROUP_MS) {
      h.lastType = now;
      return;
    }
    h.lastType = kind === 'type' ? now : 0;
    h.undo.push({ runs: runs.current, sel });
    if (h.undo.length > 200) h.undo.shift();
    h.redo = [];
  };

  const setModel = (next: Run[]) => {
    runs.current = next;
    setEmpty(!plainOf(next));
    props.current.onChange(serializeRich(next));
  };

  /** 꾸밈을 바꾸는 일(막대·단축키·붙여 넣기): 모델을 바꾸고 다시 그린 뒤 선택을 둔다 */
  const apply = (next: Run[], selAfter: Sel) => {
    remember('edit', getSel(el()));
    setModel(next);
    render(el(), next, linkRef.current);
    setSel(el(), selAfter.start, selAfter.end);
    refreshBar();
  };

  /** 화면의 글을 읽어 모델에 반영(한글 조합 중이 아닐 때) */
  const syncModel = () => {
    const root = ref.current;
    if (!root || composing.current) return;
    const plain = readPlain(root);
    if (plain === plainOf(runs.current)) return;
    remember('type', before.current);
    setModel(applyPlainEdit(runs.current, plain, before.current ?? undefined));
    before.current = getSel(root);
  };
  /** 화면이 모델과 다르게 꾸며져 있으면(링크 끝에 이어 쓴 글이 링크 안에 들어감 등) 모델대로 다시 그린다 */
  const fixDom = () => {
    const root = ref.current;
    if (!root || composing.current) return;
    if (sameRuns(readRuns(root), runs.current)) return;
    const s = getSel(root);
    render(root, runs.current, linkRef.current);
    if (s) setSel(root, s.start, s.end);
  };

  const step = (redo: boolean) => {
    const h = history.current;
    const from = redo ? h.redo : h.undo;
    const snap = from.pop();
    if (!snap) return;
    (redo ? h.undo : h.redo).push({ runs: runs.current, sel: getSel(el()) });
    h.lastType = 0;
    setModel(snap.runs);
    render(el(), snap.runs, linkRef.current);
    const len = plainOf(snap.runs).length;
    const s = snap.sel ?? { start: len, end: len };
    setSel(el(), Math.min(s.start, len), Math.min(s.end, len));
  };

  const format = (k: Mark) => {
    const s = getSel(el());
    if (!s || s.end <= s.start) return;
    apply(toggleMark(runs.current, s.start, s.end, k), s);
  };

  const openLink = () => {
    const s = getSel(el());
    if (!s || s.end <= s.start) return;
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    setBar(null);
    setLinking({ sel: s, rect, href: linkOf(runs.current, s.start, s.end) ?? '' });
  };
  /** 주소(넣기) · null(링크 빼기) · undefined(그만두기) */
  const linkDone = (href: string | null | undefined) => {
    const l = linkingRef.current;
    setLinking(null);
    const root = ref.current;
    if (!l || !root) return;
    root.focus({ preventScroll: true });
    if (href === undefined) {
      setSel(root, l.sel.start, l.sel.end);
      refreshBar();
      return;
    }
    apply(setLink(runs.current, l.sel.start, l.sel.end, href), { start: l.sel.end, end: l.sel.end });
  };
  const submitLink = () => {
    const href = normalizeUrl(linkInput.current?.value ?? '');
    if (!href) return showToast({ message: t('linkInvalid') });
    linkDone(href);
  };

  const enter = () => {
    const root = el();
    const s = getSel(root) ?? { start: plainOf(runs.current).length, end: plainOf(runs.current).length };
    if (!props.current.onSplit) {
      root.blur();
      return;
    }
    const cur = replaceRange(runs.current, s.start, s.end, '');
    const len = plainOf(cur).length;
    props.current.onSplit(serializeRich(sliceRuns(cur, 0, s.start)), [serializeRich(sliceRuns(cur, s.start, len))], 0);
  };

  /** 막대: 마우스로 끌어 고르는 중엔 숨겼다가 놓으면, 키보드(Shift+화살표)로 고르면 바로 */
  const refreshBar = () => {
    const root = ref.current;
    if (!root || linkingRef.current) return;
    const s = getSel(root);
    if (!s || s.end <= s.start || document.activeElement !== root || dragging.current) return setBar(null);
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    setBar({ sel: s, rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, active: active(s) });
  };
  const refreshRef = useRef(refreshBar);
  useLayoutEffect(() => {
    refreshRef.current = refreshBar;
  });

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.contentEditable = 'true';
    Object.assign(root.style, { outline: 'none', cursor: 'text', userSelect: 'text', webkitUserSelect: 'text', whiteSpace: 'pre-wrap', caretColor: theme.accent });
    if (p.style.lineHeight) root.style.minHeight = `${p.style.lineHeight}px`;
    render(root, runs.current, linkRef.current);
    root.focus();
    const c = Math.min(p.caret, plainOf(runs.current).length);
    setSel(root, c, c);
    // 포커스 직후 브라우저가 커서를 맨 앞으로 되돌리는 때가 있어 한 번 더(그사이 사용자가 옮겼으면 건드리지 않는다)
    requestAnimationFrame(() => {
      const s = getSel(root);
      if (c && s && s.start === 0 && s.end === 0) setSel(root, c, c);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onBeforeInput = (e: InputEvent) => {
      const it = e.inputType;
      if (it === 'historyUndo' || it === 'historyRedo') {
        e.preventDefault();
        step(it === 'historyRedo');
        return;
      }
      if (it === 'insertParagraph' || it === 'insertLineBreak') {
        e.preventDefault();
        if (!e.isComposing) enter();
        return;
      }
      // 브라우저 자체 서식(오른쪽 클릭 메뉴 등)·끌어다 놓기는 받지 않는다
      if (it.startsWith('format') || it === 'insertFromDrop' || it === 'deleteByDrag') {
        e.preventDefault();
        return;
      }
      if (!composing.current) before.current = getSel(root);
    };
    const onInput = (e: Event) => {
      if ((e as InputEvent).isComposing || composing.current) return;
      syncModel();
      fixDom();
    };
    const onCompStart = () => {
      composing.current = true;
      before.current = getSel(root);
      setBar(null);
    };
    const onCompEnd = () => {
      composing.current = false;
      syncModel();
      // 다음 글자 조합이 곧바로 이어지면 화면은 그다음에 맞춘다
      setTimeout(fixDom, 0);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const c = e.code;
        const run = (f: () => void) => {
          e.preventDefault();
          f();
        };
        if (c === 'KeyB' && !e.shiftKey) return run(() => format('b'));
        if (c === 'KeyU' && !e.shiftKey) return run(() => format('u'));
        if ((c === 'KeyX' || c === 'KeyS') && e.shiftKey) return run(() => format('s'));
        if (c === 'KeyK') return run(openLink);
        if (c === 'KeyI') return run(() => {});
        if (c === 'KeyZ' && !e.shiftKey) return run(() => step(false));
        if (c === 'KeyY' || (c === 'KeyZ' && e.shiftKey)) return run(() => step(true));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        enter();
        return;
      }
      if (e.key === 'Backspace' && props.current.onMergeBack) {
        const s = getSel(root);
        if (s && s.start === 0 && s.end === 0) {
          e.preventDefault();
          props.current.onMergeBack(serializeRich(runs.current));
        }
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
      if (!text) return;
      const len = plainOf(runs.current).length;
      const s = getSel(root) ?? { start: len, end: len };
      const trimmed = text.trim();
      // 고른 글 위에 주소를 붙여 넣으면 그 글이 링크로(글은 그대로)
      const url = s.end > s.start && /^(https?:\/\/|www\.)\S+$/i.test(trimmed) ? normalizeUrl(trimmed) : null;
      if (url) return apply(setLink(runs.current, s.start, s.end, url), { start: s.end, end: s.end });
      if (props.current.onSplit && text.includes('\n')) {
        const parts = splitRunsByLine(replaceRange(runs.current, s.start, s.end, text));
        const tail = len - s.end;
        props.current.onSplit(serializeRich(parts[0]), parts.slice(1).map(serializeRich), Math.max(0, plainOf(parts[parts.length - 1]).length - tail));
        return;
      }
      const flat = props.current.onSplit ? text : text.replace(/\s*\n+\s*/g, ' ');
      const at = s.start + flat.length;
      apply(replaceRange(runs.current, s.start, s.end, flat), { start: at, end: at });
    };
    const onBlur = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      // 막대(링크 주소 칸)로 옮겨 가는 것은 편집 중
      if ((to && barEl.current?.contains(to)) || linkingRef.current) return;
      // 문단을 나누거나 합쳐 다른 문단으로 편집이 넘어가면 이 칸은 화면에서 빠지며 포커스를 잃는다:
      // 그때 편집을 끝내면 새 문단의 편집까지 끝나서, 이 칸이 아직 있고 다시 포커스를 받지 않았을 때만 끝낸다
      setTimeout(() => {
        if (!alive.current || !root.isConnected || document.activeElement === root || linkingRef.current) return;
        setBar(null);
        props.current.onEnd();
      }, 0);
    };
    const onMouseDown = () => {
      dragging.current = true;
      setBar(null);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setTimeout(() => refreshRef.current(), 0);
    };
    const onSelChange = () => refreshRef.current();
    const noDrag = (e: Event) => e.preventDefault();
    alive.current = true;
    root.addEventListener('beforeinput', onBeforeInput);
    root.addEventListener('input', onInput);
    root.addEventListener('compositionstart', onCompStart);
    root.addEventListener('compositionend', onCompEnd);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('paste', onPaste);
    root.addEventListener('blur', onBlur);
    root.addEventListener('mousedown', onMouseDown);
    root.addEventListener('dragstart', noDrag);
    root.addEventListener('drop', noDrag);
    window.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      alive.current = false;
      root.removeEventListener('beforeinput', onBeforeInput);
      root.removeEventListener('input', onInput);
      root.removeEventListener('compositionstart', onCompStart);
      root.removeEventListener('compositionend', onCompEnd);
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('paste', onPaste);
      root.removeEventListener('blur', onBlur);
      root.removeEventListener('mousedown', onMouseDown);
      root.removeEventListener('dragstart', noDrag);
      root.removeEventListener('drop', noDrag);
      window.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('selectionchange', onSelChange);
    };
    // 처리기는 ref로 최신 값을 읽는다(한 번만 붙인다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 편집을 시작한 뒤 아직 고치지 않았는데 글이 바뀌어 오면(문단 합치기: 저장이 화면보다 먼저 끝난다) 새 글로.
  // 예전엔 합치기 전 글로 열려, 이어서 엔터를 치면 합쳐 온 글이 지워졌다
  const base = useRef<string | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    const cur = serializeRich(runs.current);
    if (base.current === null) base.current = cur;
    const next = serializeRich(parseRich(p.initial));
    if (!root || next === cur) {
      base.current = next;
      return;
    }
    if (cur !== base.current) return;
    const s = getSel(root);
    runs.current = parseRich(p.initial);
    base.current = next;
    setEmpty(!plainOf(runs.current));
    render(root, runs.current, linkRef.current);
    const len = plainOf(runs.current).length;
    if (s) setSel(root, Math.min(s.start, len), Math.min(s.end, len));
  }, [p.initial]);

  // 링크 색은 테마를 따라(편집 중 테마가 바뀌면 다시 그린다)
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-href]').forEach((x) => (x.style.color = link));
  }, [link]);

  function active(s: Sel): Active {
    return {
      b: allMarked(runs.current, s.start, s.end, 'b'),
      u: allMarked(runs.current, s.start, s.end, 'u'),
      s: allMarked(runs.current, s.start, s.end, 's'),
      a: allMarked(runs.current, s.start, s.end, 'a'),
    };
  }

  const shown = linking ?? bar;
  let floating: ReactNode = null;
  if (shown) {
    const w = linking ? Math.min(340, window.innerWidth - 16) : BAR_W;
    const mid = (shown.rect.left + shown.rect.right) / 2;
    const left = Math.max(8, Math.min(mid - w / 2, window.innerWidth - 8 - w));
    const above = shown.rect.top - 8 - BAR_H;
    const top = above >= 4 ? above : Math.min(shown.rect.bottom + 8, window.innerHeight - 4 - BAR_H);
    const bg = theme.dark ? '#3A3D44' : '#2B2E33';
    const on = deepAccent(theme.accent);
    const font = theme.font(13).fontFamily as string | undefined;
    const box: CSSProperties = {
      position: 'fixed',
      left,
      top,
      width: w,
      height: BAR_H,
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '0 4px',
      borderRadius: 10,
      background: bg,
      boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      zIndex: 1000,
      fontFamily: font,
      WebkitAppRegion: 'no-drag',
    } as CSSProperties;
    const btn = (on_: boolean): CSSProperties => ({
      width: 30,
      height: 28,
      border: 0,
      borderRadius: 7,
      padding: 0,
      cursor: 'pointer',
      color: '#FFFFFF',
      fontSize: 15,
      fontFamily: font,
      background: on_ ? on : 'transparent',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    const linkSvg = (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={linking ? '#C9CDD3' : '#FFFFFF'} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
        <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
      </svg>
    );
    const keep = (e: { target: EventTarget; preventDefault: () => void }) => {
      // 단추를 눌러도 입력칸의 포커스·선택이 그대로 남게(주소 칸만 포커스를 받는다)
      if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
    };
    if (linking) {
      floating = (
        <div ref={barEl} style={{ ...box, paddingLeft: 10 }} onMouseDown={keep}>
          {linkSvg}
          <input
            ref={linkInput}
            autoFocus
            defaultValue={linking.href}
            placeholder={t('linkPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submitLink();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                linkDone(undefined);
              }
            }}
            onBlur={(e) => {
              const to = e.relatedTarget as Node | null;
              if (to && (barEl.current?.contains(to) || to === ref.current)) return;
              // 다른 곳을 누르면 링크는 그만두고 편집도 끝
              setLinking(null);
              props.current.onEnd();
            }}
            style={{ flex: 1, minWidth: 0, height: 26, border: 0, outline: 'none', background: 'transparent', color: '#FFFFFF', fontSize: 13, fontFamily: font, padding: '0 6px' }}
          />
          {linking.href ? (
            <button type="button" onClick={() => linkDone(null)} style={{ ...btn(false), width: 'auto', padding: '0 8px', fontSize: 12.5, color: '#C9CDD3' }}>
              {t('linkRemove')}
            </button>
          ) : null}
          <button type="button" onClick={submitLink} style={{ ...btn(true), width: 'auto', padding: '0 10px', fontSize: 12.5, fontWeight: 600 }}>
            {t('linkApply')}
          </button>
        </div>
      );
    } else if (bar) {
      const a = bar.active ?? { b: false, u: false, s: false, a: false };
      floating = (
        <div ref={barEl} style={box} onMouseDown={keep} role="toolbar">
          <button type="button" title={`${t('fmtBold')} (Ctrl+B)`} aria-pressed={a.b} onClick={() => format('b')} style={btn(a.b)}>
            <span style={{ fontWeight: 700 }}>B</span>
          </button>
          <button type="button" title={`${t('fmtUnderline')} (Ctrl+U)`} aria-pressed={a.u} onClick={() => format('u')} style={btn(a.u)}>
            <span style={{ textDecoration: 'underline' }}>U</span>
          </button>
          <button type="button" title={`${t('fmtStrike')} (Ctrl+Shift+X)`} aria-pressed={a.s} onClick={() => format('s')} style={btn(a.s)}>
            <span style={{ textDecoration: 'line-through' }}>S</span>
          </button>
          <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.25)', margin: '0 3px' }} />
          <button type="button" title={`${t('fmtLink')} (Ctrl+K)`} aria-pressed={a.a} onClick={openLink} style={btn(a.a)}>
            {linkSvg}
          </button>
        </div>
      );
    }
  }

  return (
    <View>
      <RNText ref={ref as never} style={p.style} />
      {empty && p.placeholder ? (
        <RNText pointerEvents="none" style={[p.style, { position: 'absolute', left: 0, top: 0, color: theme.muted }]}>
          {p.placeholder}
        </RNText>
      ) : null}
      {floating ? createPortal(floating, document.body) : null}
    </View>
  );
}
