import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizeUrl, type Mark } from '../core/rich';
import { useUi } from '../state/AppContext';
import { deepAccent } from './color';
import { CloseIcon, LinkIcon } from './Icons';

/**
 * 휴대폰: 글자를 끌어 고르면 키보드 바로 위에 뜨는 꾸미기 막대(굵게 · 밑줄 · 취소선 · 링크).
 * OS가 고른 글 위에 띄우는 메뉴(복사·붙여넣기)와 겹치지 않게 키보드 위에 둔다.
 * 막대는 목록 밖 맨 위층(FormatBarHost, MainLayout의 키보드 위 자리)에 그린다.
 */
let setBar: ((n: ReactNode) => void) | null = null;

export function FormatBarHost() {
  const [node, set] = useState<ReactNode>(null);
  useEffect(() => {
    setBar = set;
    return () => {
      setBar = null;
    };
  }, []);
  return node ? (
    <View pointerEvents="box-none" style={styles.host}>
      {node}
    </View>
  ) : null;
}

/** 편집 중인 입력칸이 막대를 띄운다(null이면 내린다) */
export function useFormatBar(node: ReactNode) {
  useEffect(() => {
    setBar?.(node);
  });
  useEffect(() => () => setBar?.(null), []);
}

export type Active = { b: boolean; u: boolean; s: boolean; a: boolean };

/** 링크 주소 넣는 중: href = 지금 링크(없으면 '') */
export type Linking = { href: string };

/** onLinkDone: 주소(넣기), null(링크 빼기), undefined(그만두기) */
export function FormatBar(p: {
  active: Active;
  onToggle: (k: Mark) => void;
  onLink: () => void;
  linking: Linking | null;
  onLinkDone: (href: string | null | undefined) => void;
}) {
  const { theme, t, showToast } = useUi();
  const [url, setUrl] = useState(p.linking?.href ?? '');
  // 링크 주소 칸을 새로 열면 그 링크의 주소로
  const linkingHref = p.linking?.href;
  const [seen, setSeen] = useState(linkingHref);
  if (seen !== linkingHref) {
    setSeen(linkingHref);
    setUrl(linkingHref ?? '');
  }
  const bg = theme.dark ? '#3A3D44' : '#2B2E33';
  const on = deepAccent(theme.accent);
  const submit = () => {
    const href = normalizeUrl(url);
    if (!href) return showToast({ message: t('linkInvalid') });
    p.onLinkDone(href);
  };
  if (p.linking) {
    return (
      <View style={[styles.bar, styles.linkBar, { backgroundColor: bg }]}>
        <LinkIcon color="#C9CDD3" size={17} />
        <TextInput
          autoFocus
          value={url}
          onChangeText={setUrl}
          onSubmitEditing={submit}
          placeholder={t('linkPlaceholder')}
          placeholderTextColor="#9AA0A8"
          selectionColor={theme.selection}
          cursorColor="#FFFFFF"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          submitBehavior="submit"
          underlineColorAndroid="transparent"
          style={[theme.font(15, { color: '#FFFFFF' }), styles.url]}
        />
        {p.linking.href ? (
          <Pressable onPress={() => p.onLinkDone(null)} hitSlop={4} accessibilityRole="button" style={styles.textBtn}>
            <Text style={theme.font(14, { color: '#C9CDD3' })}>{t('linkRemove')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={submit} hitSlop={4} accessibilityRole="button" style={[styles.apply, { backgroundColor: on }]}>
          <Text style={theme.font(14, { color: '#FFFFFF', fontWeight: '600' })}>{t('linkApply')}</Text>
        </Pressable>
        <Pressable onPress={() => p.onLinkDone(undefined)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('cancel')} style={styles.close}>
          <CloseIcon color="#C9CDD3" size={13} />
        </Pressable>
      </View>
    );
  }
  const btn = (k: Mark | 'a', label: string, glyph: ReactNode) => (
    <Pressable
      key={k}
      onPress={() => (k === 'a' ? p.onLink() : p.onToggle(k))}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: p.active[k] }}
      style={({ pressed }) => [styles.btn, p.active[k] && { backgroundColor: on }, pressed && { opacity: 0.7 }]}
    >
      {glyph}
    </Pressable>
  );
  const g = (ch: string, extra: object) => <Text style={[theme.font(17, { color: '#FFFFFF' }), extra]}>{ch}</Text>;
  return (
    <View style={[styles.bar, { backgroundColor: bg }]}>
      {btn('b', t('fmtBold'), g('B', BOLD))}
      {btn('u', t('fmtUnderline'), g('U', UNDER))}
      {btn('s', t('fmtStrike'), g('S', STRIKE))}
      <View style={styles.sep} />
      {btn('a', t('fmtLink'), <LinkIcon color="#FFFFFF" size={19} />)}
    </View>
  );
}

const BOLD = { fontWeight: '700' } as const;
const UNDER = { textDecorationLine: 'underline' } as const;
const STRIKE = { textDecorationLine: 'line-through' } as const;

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: 8, paddingHorizontal: 12 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 4,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  linkBar: { alignSelf: 'stretch', paddingLeft: 12 },
  btn: { width: 44, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginHorizontal: 1 },
  sep: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: '#FFFFFF40', marginHorizontal: 4 },
  url: { flex: 1, paddingVertical: 8, paddingHorizontal: 8 },
  textBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  apply: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, marginLeft: 2 },
  close: { width: 34, height: 36, alignItems: 'center', justifyContent: 'center' },
});
