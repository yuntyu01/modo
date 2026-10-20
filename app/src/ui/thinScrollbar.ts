/**
 * PC(웹): 기본 스크롤 막대는 숨기고, 마우스를 올린 목록의 오른쪽에 아주 가는(3px) 막대만 옅게 띄운다.
 * 윈도우 크롬(152~)은 ::-webkit-scrollbar 꾸미기를 무시해서 막대가 8~10px로 두껍게 남았다(메모·카드 글자 위에 겹쳐 보였다).
 * 겹친 목록(메모 안 · 바깥 목록)은 마우스 아래 가장 안쪽 목록 하나에만 보인다. 막대를 잡고 끌어 넘길 수도 있다.
 */
export function installThinScrollbars() {
  if (typeof document === 'undefined' || document.getElementById('modo-scrollbar')) return;
  const style = document.createElement('style');
  style.id = 'modo-scrollbar';
  style.textContent = '*{scrollbar-width:none}*::-webkit-scrollbar{display:none}';
  document.head.appendChild(style);

  const thumb = document.createElement('div');
  Object.assign(thumb.style, {
    position: 'fixed',
    width: '3px',
    borderRadius: '1.5px',
    background: 'rgba(128,128,128,.4)',
    zIndex: '2147483647',
    opacity: '0',
    pointerEvents: 'none',
    transition: 'opacity .18s',
    // 막대만 보면 가늘어 잡기 어려워 투명한 테두리로 잡는 자리를 넓힌다
    border: '0 solid transparent',
    borderLeftWidth: '4px',
    borderRightWidth: '2px',
    backgroundClip: 'padding-box',
    boxSizing: 'content-box',
  } as Partial<CSSStyleDeclaration>);
  const mount = () => document.body && !thumb.isConnected && document.body.appendChild(thumb);

  let target: HTMLElement | null = null;
  let dragging = false;
  const scrollableOf = (el: Element | null): HTMLElement | null => {
    for (let e = el as HTMLElement | null; e && e !== document.documentElement; e = e.parentElement) {
      const o = getComputedStyle(e).overflowY;
      if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1) return e;
    }
    return null;
  };
  let pending: Element | null = null;
  let raf = 0;
  const hide = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      pending = null;
    }
    if (dragging) return;
    thumb.style.opacity = '0';
    thumb.style.pointerEvents = 'none';
  };
  const place = () => {
    const t = target;
    if (!t || !t.isConnected || t.scrollHeight <= t.clientHeight + 1) return hide();
    mount();
    const r = t.getBoundingClientRect();
    const h = Math.max(24, (r.height * t.clientHeight) / t.scrollHeight);
    const top = r.top + 2 + ((r.height - 4 - h) * t.scrollTop) / (t.scrollHeight - t.clientHeight);
    thumb.style.left = `${r.right - 9}px`;
    thumb.style.top = `${top}px`;
    thumb.style.height = `${h}px`;
    thumb.style.opacity = '1';
    thumb.style.pointerEvents = 'auto';
  };
  // 마우스가 지나는 요소마다 오는 mouseover를 프레임당 한 번으로 모은다(요소마다 조상을 거슬러 getComputedStyle을 불렀다)
  const flushHover = () => {
    raf = 0;
    const el = pending;
    pending = null;
    if (dragging || !el) return;
    target = scrollableOf(el);
    place();
  };
  window.addEventListener(
    'mouseover',
    (e) => {
      if (dragging || e.target === thumb) return;
      pending = e.target as Element;
      if (!raf) raf = requestAnimationFrame(flushHover);
    },
    true,
  );
  document.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
  // 휠로 넘기는 동안 따라간다(마우스 아래 목록일 때만)
  window.addEventListener('scroll', (e) => e.target === target && place(), { capture: true, passive: true });
  window.addEventListener('resize', place);

  thumb.addEventListener('mouseenter', () => (thumb.style.background = 'rgba(128,128,128,.6)'));
  thumb.addEventListener('mouseleave', () => (thumb.style.background = 'rgba(128,128,128,.4)'));
  thumb.addEventListener('mousedown', (e) => {
    const t = target;
    if (!t || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    const startY = e.clientY;
    const startTop = t.scrollTop;
    const r = t.getBoundingClientRect();
    const h = Math.max(24, (r.height * t.clientHeight) / t.scrollHeight);
    const perPx = (t.scrollHeight - t.clientHeight) / Math.max(1, r.height - 4 - h);
    document.body.style.userSelect = 'none';
    const move = (m: MouseEvent) => {
      t.scrollTop = startTop + (m.clientY - startY) * perPx;
      place();
    };
    const up = () => {
      dragging = false;
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  });
}
