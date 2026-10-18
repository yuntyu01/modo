import { BlurTargetView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Slot } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '../../state/AppContext';
import { desktop } from '../../native/bridge';
import { BottomNav, NAV_HEIGHT } from '../../ui/BottomNav';
import { BlurTargetContext } from '../../ui/glass';
import { BottomInsetContext, contentColumn, useWide } from '../../ui/layout';
import { LoginGate } from '../../ui/LoginGate';
import { coachStore } from '../../ui/onboarding/coach';
import { CoachOverlay } from '../../ui/onboarding/CoachOverlay';
import { Welcome } from '../../ui/onboarding/Welcome';
import { ToastHost } from '../../ui/primitives';

/** 목록·캘린더·더보기 공통 틀: 상단 테마색 그라데이션, 하단 내비게이션. */
export default function MainLayout() {
  const { theme, serverApi, account, loginDeferred, deferLogin, prefs, setPrefs } = useApp();
  const insets = useSafeAreaInsets();
  const { compact } = useWide();
  // 유리 하단바·입력창이 흐리게 비출 대상(Android는 대상을 감싸 알려 줘야 한다)
  const blurTarget = useRef<View>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [kavKey, setKavKey] = useState(0);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    // 다른 창(빠른 추가)의 키보드 이벤트가 섞여 들어와 '키보드 열림'으로 남는 경우가 있어 앞으로 올 때 실제 상태로 맞춘다.
    const c = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      const open = Keyboard.isVisible();
      setKeyboard(open);
      if (!open) setKavKey((k) => k + 1);
    });
    return () => {
      a.remove();
      b.remove();
      c.remove();
    };
  }, []);
  // 하단바 아래 여백(시안 25~26dp). 아이폰은 홈 표시줄(34dp) 위로 살짝 겹쳐도 되고, Android 내비게이션 버튼은 피한다.
  const bottomGap = Platform.OS === 'web' ? 28 : compact ? 4 : Math.max(26, Platform.OS === 'ios' ? insets.bottom - 8 : insets.bottom);
  const navSpace = keyboard ? 8 : 50 + 12 + bottomGap;
  // 휴대폰: 하단바는 따로 자리를 차지하지 않고 내용 위에 떠 있다(양옆·아래로 내용이 비친다). 화면들은 이 높이만큼 스크롤 끝 여백을 둔다.
  // PC 큰 창(시안): 하단바는 창 아래에 붙은 줄이라 자리를 차지한다(덮는 높이 0).
  const web = Platform.OS === 'web';
  const navInset = keyboard || web ? 0 : NAV_HEIGHT + bottomGap;
  // 첫 실행 화면(휴대폰, 처음 설치): 테마색 + 첫 할 일. '이미 계정이 있어요'를 누르면 로그인 화면으로(거기서 '나중에'면 다시 여기로)
  const canLogin = !!serverApi && (serverApi.kakao || serverApi.google || serverApi.password);
  const [welcomeLogin, setWelcomeLogin] = useState(false);
  const welcome = !web && !prefs.onboarded && !account && (!welcomeLogin || loginDeferred);
  // 로그인해서 들어온 사람(다시 설치 등)은 첫 실행 화면을 건너뛴다
  useEffect(() => {
    if (account && !prefs.onboarded) setPrefs({ onboarded: true });
  }, [account, prefs.onboarded, setPrefs]);
  // 서버가 닿고 아직 로그인하지 않았으면 처음에 로그인 화면(이번 실행에서 '나중에'를 누르면 넘어간다). 첫 실행 화면이 먼저
  const gate = canLogin && !account && !loginDeferred && !welcome;
  // PC 창 버튼(– □ ×) 색을 테마에 맞춘다(라이트에서 밝은 회색이면 안 보인다)
  useEffect(() => {
    desktop?.setTitleBarDark?.(theme.dark);
  }, [theme.dark]);
  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <LinearGradient
        pointerEvents="none"
        colors={[theme.gradientTop, theme.gradientMid, theme.bg]}
        // 테마마다 정한 위치(theme.gradientStops)에서 바탕색이 되게
        locations={theme.gradientStops}
        style={StyleSheet.absoluteFill}
      />
      {/* PC 큰 창: 제목줄이 없어서 위쪽 띠를 잡고 창을 옮긴다(오른쪽 창 버튼 자리는 비움) */}
      {Platform.OS === 'web' ? <View style={[styles.drag, { WebkitAppRegion: 'drag' } as object]} /> : null}
      {/* 서버가 닿고 아직 로그인하지 않았으면 처음에 카카오 로그인(로그인하면 늘 동기화) */}
      {gate ? <LoginGate /> : null}
      {gate ? null : (
      <KeyboardAvoidingView key={kavKey} style={[{ flex: 1 }, contentColumn]} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <BlurTargetView ref={blurTarget} style={{ flex: 1, paddingBottom: keyboard ? 8 : 0 }}>
          <BlurTargetContext.Provider value={blurTarget}>
            <BottomInsetContext.Provider value={navInset}>
              <Slot />
            </BottomInsetContext.Provider>
          </BlurTargetContext.Provider>
        </BlurTargetView>
        {web ? (
          // PC 큰 창: 창 아래에 붙은 줄(바탕색 띠, 목록은 그 위에서 끝난다)
          <View
            style={{ paddingHorizontal: 12, paddingBottom: theme.desk ? 3 : 6, backgroundColor: theme.desk ? theme.bg : undefined }}
          >
            <BottomNav />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      )}
      {!keyboard && !web && !gate ? (
        <View pointerEvents="box-none" style={[styles.navLayer, { paddingBottom: bottomGap }]}>
          {/* 화이트 시안: 입력창과 거의 같은 너비(좌우 19) */}
          <View style={[contentColumn, { paddingHorizontal: 19 }]}>
            <BlurTargetContext.Provider value={blurTarget}>
              <BottomNav />
            </BlurTargetContext.Provider>
          </View>
        </View>
      ) : null}
      <ToastHost bottom={navSpace + 80} />
      {welcome ? (
        <Welcome
          onStart={(todoId, from) => {
            // 이번 실행은 로그인 화면 없이 홈 안내로(다음 실행부터 로그인 화면)
            deferLogin();
            coachStore.set({ todoId, from });
          }}
          onHidden={() => setPrefs({ onboarded: true })}
          onLogin={canLogin ? () => setWelcomeLogin(true) : undefined}
        />
      ) : null}
      <CoachOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  drag: { position: 'absolute', top: 0, left: 0, right: 150, height: 36, zIndex: 10 },
  navLayer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
