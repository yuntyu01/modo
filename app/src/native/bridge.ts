import { requireOptionalNativeModule } from 'expo-modules-core';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * 네이티브 기능 진입점. Android는 modules/modo-native(Kotlin), iOS는 같은 모듈의 Swift 쪽.
 * 모듈이 없는 환경(Expo Go, 웹)에서는 아무 일도 하지 않는다.
 */
type NativeModule = {
  loginWithKakaoTalk?(): Promise<string | null>;
  /** 위젯·잠금화면 알림·리마인더를 DB 기준으로 다시 그린다/예약한다 */
  /** 위젯·잠금화면 알림·리마인더를 DB 기준으로 다시 맞춘다. tables = 바뀐 표(없으면 전부). 문단만 바뀌었으면 알림 예약은 건너뛴다 */
  refresh(tables?: string[]): Promise<void>;
  requestPinWidget(): Promise<boolean>;
  requestAddTile(): Promise<'added' | 'already' | 'dismissed' | 'unsupported'>;
  /** 잠금화면 위젯을 이 기기·런처가 지원하는지 */
  /** maybe: OS는 지원하지만 켜는 메뉴가 제조사에 달린 경우(Android 16 QPR2+ 휴대폰) */
  lockScreenWidgetSupport(): Promise<{ supported: boolean; maybe?: boolean; reason: string }>;
  notificationPermission(): Promise<'granted' | 'denied' | 'undetermined'>;
  /** Android만: 알림 권한을 한 번 물었다고 남긴다(그 전에는 꺼져 있어도 'undetermined') */
  markNotificationAsked?(): Promise<void>;
  /** iOS만: UNUserNotificationCenter 권한 요청(Android는 PermissionsAndroid) */
  requestNotificationPermission?(): Promise<'granted' | 'denied' | 'undetermined'>;
  canScheduleExactAlarms(): Promise<boolean>;
  openExactAlarmSettings(): Promise<void>;
  /** 빠른 추가·위젯·알림이 DB를 바꿨을 때 */
  addListener(event: 'onDataChanged', fn: (e?: { tables?: string[] }) => void): { remove(): void };
};

const mod = Platform.OS === 'web' ? null : requireOptionalNativeModule<NativeModule>('ModoNative');

export const native = {
  available: !!mod,
  loginWithKakaoTalk: () => mod?.loginWithKakaoTalk?.() ?? Promise.resolve(null),
  refresh: (tables?: string[]) => mod?.refresh(tables).catch(() => {}),
  requestPinWidget: async () => (mod ? mod.requestPinWidget() : false),
  requestAddTile: async () => (mod ? mod.requestAddTile() : 'unsupported'),
  lockScreenWidgetSupport: async () =>
    mod ? mod.lockScreenWidgetSupport() : { supported: false, reason: 'native module unavailable' },
  notificationPermission: async () => (mod ? mod.notificationPermission() : 'undetermined'),
  requestNotificationPermission: async (): Promise<'granted' | 'denied' | 'undetermined'> => {
    if (Platform.OS === 'android') {
      if (Number(Platform.Version) < 33) return mod ? mod.notificationPermission() : 'granted';
      const r = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
      await mod?.markNotificationAsked?.();
      return r === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
    }
    return mod?.requestNotificationPermission ? mod.requestNotificationPermission() : 'undetermined';
  },
  canScheduleExactAlarms: async () => (mod ? mod.canScheduleExactAlarms() : false),
  openExactAlarmSettings: async () => mod?.openExactAlarmSettings(),
  /** tables = 네이티브가 바꾼 표(없으면 전부 다시 읽는다) */
  onDataChanged: (fn: (tables?: string[]) => void) => {
    const sub = mod?.addListener?.('onDataChanged', (e) => fn(e?.tables));
    return () => sub?.remove();
  },
};

/** Electron 미니창 제어(desktop/preload.cjs). */
export type DesktopApi = {
  toggleMini(): Promise<void>;
  platform: string;
  setPinned(on: boolean): Promise<void>;
  isPinned(): Promise<boolean>;
  hide(): Promise<void>;
  setContentHeight(h: number): Promise<void>;
  /** 미니창에서 시트를 여는 동안 창을 h까지 키운다(0 = 닫음, 내용 높이로). 예전 데스크톱 앱에는 없다 */
  setSheetHeight?(h: number): Promise<void>;
  /** 큰 창 열기. route를 주면 그 화면으로(예: '/settings/trash') */
  openSettings(route?: string): Promise<void>;
  /** 큰 창의 창 버튼(– □ ×) 색을 테마에 맞춘다 */
  setTitleBarDark?(dark: boolean): Promise<void>;
  saveFile(name: string, text: string): Promise<boolean>;
  openFile(): Promise<string | null>;
  /** 외부 로그인 창을 열고 redirect로 시작하는 주소로 돌아오면 그 주소를 준다(닫으면 null) */
  openAuth(url: string, redirect: string): Promise<string | null>;
  /** tables: 바뀐 표(메인 동기화가 알릴 때). 없으면 전부 */
  onDataChanged(fn: (tables?: string[]) => void): () => void;
  /** tables: 바꾼 표(다른 창이 그 표만 다시 읽게). 없으면 전부 */
  notifyDataChanged(tables?: string[]): void;
  /** 창을 닫거나 앱을 끝내기 직전 메인이 '쓰던 글 저장'을 요청한다 */
  onFlushRequest?(fn: () => Promise<void>): () => void;
  /** 성능 측정용 표시(desktop/bench.cjs가 켜졌을 때만 받는다) */
  perfMark?(name: string): void;
};

export const desktop: DesktopApi | null =
  Platform.OS === 'web' && typeof window !== 'undefined' ? ((window as any).desktop as DesktopApi) ?? null : null;
