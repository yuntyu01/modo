import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider, useApp } from '../state/AppContext';
import { installThinScrollbars } from '../ui/thinScrollbar';
import { TrashFlightHost } from '../ui/trashFlight';

/**
 * 내비게이터 바탕은 투명하게: 화면마다 바탕을 직접 칠한다(contentStyle, MainLayout).
 * 기본 테마 바탕(#F2F2F2)이 깔리면 PC 미니창처럼 창이 투명해야 하는 화면에 회색 판이 생긴다.
 */
const NAV_THEME = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent' } };

// PC(웹): 기본 스크롤 막대는 숨기고 마우스를 올린 목록에만 아주 가는(3px) 막대를 띄운다
if (Platform.OS === 'web') installThinScrollbars();

function Themed() {
  const { theme } = useApp();
  useEffect(() => {
    // PC 미니창은 바탕화면이 비치는 투명한 창이라 문서 바탕을 칠하지 않는다(웹에서는 body 바탕색이 되어 창 둘레가 불투명해졌다)
    if (Platform.OS === 'web' && window.location.pathname.startsWith('/mini')) return;
    SystemUI.setBackgroundColorAsync(theme.bg).catch(() => {});
  }, [theme.bg]);
  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <ThemeProvider value={NAV_THEME}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg }, animation: 'fade' }}>
          <Stack.Screen name="quickadd" options={{ presentation: 'transparentModal', contentStyle: { backgroundColor: 'transparent' } }} />
          {/* PC 미니창: 창이 투명해서 바탕화면이 미니창 바탕 너머로 비쳐야 한다(앱 바탕색을 칠하지 않는다) */}
          <Stack.Screen name="mini" options={{ contentStyle: { backgroundColor: 'transparent' } }} />
        </Stack>
      </ThemeProvider>
      {/* 옆으로 밀어 지운 할 일이 ⋯(휴지통)로 날아가는 층: 모든 화면 위 */}
      <TrashFlightHost />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Platform.OS === 'web' ? 'transparent' : '#000' }}>
      <SafeAreaProvider>
        <AppProvider>
          <Themed />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
