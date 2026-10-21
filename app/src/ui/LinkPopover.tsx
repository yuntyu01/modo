import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { displayUrl } from '../core/rich';
import { useUi } from '../state/AppContext';
import { deepAccent } from './color';
import { LinkIcon } from './Icons';
import { useOpenUrl } from './openUrl';

/**
 * 글 속 링크를 누르면 그 위에 뜨는 말풍선: 링크 주소 + 바로가기(사용자 요청 2026-10-21).
 * - 바로가기를 누르면 링크로 간다. 말풍선 밖을 누르면 닫히고, 그 손짓은 원래대로(글을 누르면 고치기) 이어진다.
 * - 말풍선이 떠 있을 때 같은 글을 다시 누르면 링크로 가지 않고 고치기(EditableText가 justClosed로 안다).
 * 목록 칸 안에 두면 다음 카드에 가려지거나 창 끝에서 잘려서, 화면 맨 위층(LinkPopoverHost)에 띄운다.
 */
type Shown = { key: string; href: string; x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

let setShown: ((s: Shown | null) => void) | null = null;
let current: Shown | null = null;
let rect: Rect | null = null;
let closed: { key: string; at: number } | null = null;

function close() {
  if (!current) return;
  closed = { key: current.key, at: Date.now() };
  current = null;
  rect = null;
  setShown?.(null);
}

export const linkPopover = {
  /** x, y = 누른 자리(창 기준) */
  show(s: Shown) {
    current = s;
    rect = null;
    setShown?.(s);
  },
  close,
  /** 방금(이번 손짓에) 이 글의 말풍선이 닫혔는지: 그러면 링크 대신 고치기 */
  justClosed(key: string) {
    return !!closed && closed.key === key && Date.now() - closed.at < 700;
  },
  /** 휴대폰: 맨 바깥 View가 모든 손짓의 시작을 알려 준다(말풍선 밖이면 닫는다). 손짓은 가로채지 않는다 */
  touch(x: number, y: number) {
    if (!current) return;
    if (rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return;
    close();
  },
};

const EDGE = 8;
const GAP = 12;

export function LinkPopoverHost() {
  const { theme, t } = useUi();
  const openUrl = useOpenUrl();
  const win = useWindowDimensions();
  const [shown, set] = useState<Shown | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const box = useRef<View>(null);
  useEffect(() => {
    setShown = (s) => {
      setSize(null);
      set(s);
    };
    return () => {
      setShown = null;
    };
  }, []);
  // PC: 말풍선 밖을 누르거나, 굴리거나, 창을 벗어나거나, Esc면 닫는다
  useEffect(() => {
    if (Platform.OS !== 'web' || !shown) return;
    const down = (e: Event) => {
      const el = box.current as unknown as HTMLElement | null;
      if (el?.contains?.(e.target as Node)) return;
      close();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('wheel', close, { capture: true, passive: true });
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('wheel', close, { capture: true });
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key, true);
    };
  }, [shown]);

  // 휴대폰: 손짓이 말풍선 안에서 시작했는지 알 수 있게 자리를 둔다
  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  const x = shown?.x ?? 0;
  const y = shown?.y ?? 0;
  const left = Math.max(EDGE, Math.min(x - w / 2, win.width - EDGE - w));
  // 누른 자리 위에, 위 자리가 모자라면 아래에
  const above = y - GAP - h;
  const top = above >= EDGE ? above : Math.min(y + GAP + 6, win.height - EDGE - h);
  useEffect(() => {
    rect = shown && size ? { x: left, y: top, w, h } : null;
  });
  if (!shown) return null;
  const bg = theme.dark ? '#3A3D44' : '#2B2E33';
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        ref={box}
        accessibilityViewIsModal={false}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (!size || Math.abs(size.w - width) > 0.5 || Math.abs(size.h - height) > 0.5) setSize({ w: width, h: height });
        }}
        style={[styles.bubble, { left, top, backgroundColor: bg, maxWidth: Math.min(340, win.width - EDGE * 2), opacity: size ? 1 : 0 }]}
      >
        <LinkIcon color="#C9CDD3" size={15} />
        <Text numberOfLines={1} style={[theme.font(13, { color: '#FFFFFF' }), styles.url]}>
          {displayUrl(shown.href)}
        </Text>
        <Pressable
          onPress={() => {
            const href = shown.href;
            close();
            // PC는 보안상 https만 기본 브라우저로 연다(desktop/navigation.cjs): http 주소는 https로 열어 본다
            openUrl(Platform.OS === 'web' ? href.replace(/^http:/i, 'https:') : href);
          }}
          accessibilityRole="link"
          accessibilityLabel={`${t('linkGo')} ${displayUrl(shown.href)}`}
          hitSlop={6}
          style={({ pressed }) => [styles.go, { backgroundColor: deepAccent(theme.accent), opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={theme.font(13, { color: '#FFFFFF', fontWeight: '600' })}>{t('linkGo')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 11,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 10,
    zIndex: 1000,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  url: { flexShrink: 1, marginLeft: 6, marginRight: 10 },
  go: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
});
