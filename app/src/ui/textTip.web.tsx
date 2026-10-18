import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Text, View } from 'react-native';

import { useApp } from '../state/AppContext';
import type { TextTip } from './textTip';

/** 마우스를 올리고 이만큼 머물면 띄운다(목록 위를 지나가기만 할 때는 뜨지 않게) */
const DELAY = 500;
const MAX_W = 360;
/** 창 가장자리와 띄우는 거리 */
const EDGE = 8;

type At = { left: number; top?: number; bottom?: number; maxW: number };

/**
 * PC: 말줄임(…)으로 잘린 글에 마우스를 0.5초 올리면 전체 글을 말풍선으로 보여 준다(우상단 아이콘 말풍선과 같은 색·모양).
 * 목록 칸(react-native-web View는 저마다 쌓임 순서를 가진다) 안에 두면 다음 카드에 가려지거나 창 끝에서 잘려서, 문서 맨 위층(body)에 띄운다.
 * 아래 자리가 모자라면 글 위로. 잘리지 않은 글이면 띄우지 않는다.
 */
export function useTextTip(text: string, enabled: boolean): TextTip {
  const { theme } = useApp();
  const el = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [at, setAt] = useState<At | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setAt(null);
  }, []);
  useEffect(() => hide, [hide]);
  // 떠 있는 동안 목록을 굴리거나 창을 벗어나면 닫는다(글이 말풍선 밑에서 움직이지 않게)
  useEffect(() => {
    if (!at) return;
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.removeEventListener('wheel', hide, { capture: true });
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [at, hide]);

  const show = () => {
    timer.current = null;
    const node = el.current;
    if (!node || !node.isConnected) return;
    if (node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1) return;
    const r = node.getBoundingClientRect();
    // 아래로 띄울 때는 글 묶음(할 일 카드면 제목 + 날짜 줄) 밑에: 날짜 줄을 가리지 않게
    const box = node.parentElement?.getBoundingClientRect() ?? r;
    const maxW = Math.min(MAX_W, window.innerWidth - EDGE * 2);
    const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - EDGE - maxW));
    const below = window.innerHeight - box.bottom;
    setAt(below >= 90 || below >= r.top ? { left, top: box.bottom + 6, maxW } : { left, bottom: window.innerHeight - r.top + 6, maxW });
  };

  if (!enabled) return { ref: () => {}, enter: () => {}, hide: () => {}, node: null };
  return {
    ref: (v: unknown) => (el.current = (v as HTMLElement | null) ?? null),
    enter: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(show, DELAY);
    },
    hide,
    node: at
      ? createPortal(
          <View
            pointerEvents="none"
            style={[styles, { left: at.left, top: at.top, bottom: at.bottom, maxWidth: at.maxW, backgroundColor: theme.dark ? '#3A3D44' : '#2B2E33' }]}
          >
            <Text style={theme.font(12.5, { color: '#FFFFFF', lineHeight: 18 })}>{text}</Text>
          </View>,
          document.body,
        )
      : null,
  };
}

const styles = { position: 'absolute', zIndex: 1000, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 } as const;
