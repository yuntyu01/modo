import { DefaultTheme, router, Stack, ThemeProvider, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo } from 'react';
import { Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider, useApp, useSyncStatus, useUi } from '../state/AppContext';
import { LinkPopoverHost, linkPopover } from '../ui/LinkPopover';
import { installThinScrollbars } from '../ui/thinScrollbar';
import { TrashFlightHost } from '../ui/trashFlight';

/**
 * 내비게이터 바탕은 투명하게: 화면마다 바탕을 직접 칠한다(contentStyle, MainLayout).
 * 기본 테마 바탕(#F2F2F2)이 깔리면 PC 미니창처럼 창이 투명해야 하는 화면에 회색 판이 생긴다.
 */
const NAV_THEME = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent' } };

// PC(웹): 기본 스크롤 막대는 숨기고 마우스를 올린 목록에만 아주 가는(3px) 막대를 띄운다
if (Platform.OS === 'web') installThinScrollbars();
// 로딩 화면(로고)은 저장소를 열고 첫 화면을 그릴 때까지 둔다(AppContext의 ReadyMark가 내린다).
// 그냥 두면 라우터가 바로 내려, DB를 여는 동안 검은 화면이 잠깐 보였다
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * 로그인하지 않았거나 로그인이 만료됐으면 어느 화면으로 들어와도(설정·공유 링크·빠른 추가 주소) 로그인 화면(홈)으로 보낸다.
 * 홈은 그 자리에서 로그인 화면을 보이고(MainLayout), PC 미니창은 미니창 안에서 안내한다(mini.tsx).
 * 예전엔 홈만 막아, naegirok://settings/… 같은 주소로 로그인 없이 설정·빠른 추가에 들어갈 수 있었다.
 */
function AuthGuard() {
  const { account } = useApp();
  const status = useSyncStatus();
  const where = useSegments()[0];
  const out = !account || status.state === 'expired';
  useEffect(() => {
    if (out && where && where !== '(main)' && where !== 'mini') router.replace('/');
  }, [out, where]);
  return null;
}

function Themed() {
  // 테마만 읽는다(앱 상태 전체를 읽으면 저장할 때마다 내비게이터까지 다시 그려졌다)
  const { theme } = useUi();
  const screenOptions = useMemo(() => ({ headerShown: false, contentStyle: { backgroundColor: theme.bg }, animation: 'fade' as const }), [theme.bg]);
  useEffect(() => {
    // PC 미니창은 바탕화면이 비치는 투명한 창이라 문서 바탕을 칠하지 않는다(웹에서는 body 바탕색이 되어 창 둘레가 불투명해졌다)
    if (Platform.OS === 'web' && window.location.pathname.startsWith('/mini')) return;
    SystemUI.setBackgroundColorAsync(theme.bg).catch(() => {});
  }, [theme.bg]);
  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <ThemeProvider value={NAV_THEME}>
        <Stack screenOptions={screenOptions}>
          <Stack.Screen name="quickadd" options={{ presentation: 'transparentModal', contentStyle: { backgroundColor: 'transparent' } }} />
          {/* PC 미니창: 창이 투명해서 바탕화면이 미니창 바탕 너머로 비쳐야 한다(앱 바탕색을 칠하지 않는다) */}
          <Stack.Screen name="mini" options={{ contentStyle: { backgroundColor: 'transparent' } }} />
        </Stack>
      </ThemeProvider>
      {/* 옆으로 밀어 지운 할 일이 ⋯(휴지통)로 날아가는 층: 모든 화면 위 */}
      <TrashFlightHost />
      {/* 글 속 링크를 눌렀을 때 뜨는 말풍선(바로가기): 모든 화면 위 */}
      <LinkPopoverHost />
      <AuthGuard />
    </>
  );
}

function linkTouch(e: { nativeEvent: { pageX: number; pageY: number } }) {
  linkPopover.touch(e.nativeEvent.pageX, e.nativeEvent.pageY);
  return false;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Platform.OS === 'web' ? 'transparent' : '#000' }}>
      {/* 휴대폰: 화면 어디든 누르기 시작하면 링크 말풍선에 알린다(말풍선 밖이면 닫기). 손짓은 가로채지 않는다 */}
      <View style={{ flex: 1 }} onStartShouldSetResponderCapture={Platform.OS === 'web' ? undefined : linkTouch}>
        <SafeAreaProvider>
          <AppProvider>
            <Themed />
          </AppProvider>
        </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}
