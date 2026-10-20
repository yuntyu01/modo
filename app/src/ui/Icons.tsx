import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { color: string; size?: number; strokeWidth?: number };

const base = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

function S({ size = 24, children }: { size?: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {children}
    </Svg>
  );
}

export const ListIcon = ({ color, size, strokeWidth = 1.9 }: P) => (
  <S size={size}>
    {[6, 12, 18].map((y) => (
      <Circle key={`c${y}`} cx={4.6} cy={y} r={1.45} fill={color} />
    ))}
    {[6, 12, 18].map((y) => (
      <Path key={y} d={`M9 ${y}h11.5`} stroke={color} strokeWidth={strokeWidth} {...base} />
    ))}
  </S>
);

export const CalendarIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Rect x={3.5} y={5} width={17} height={15.5} rx={2.4} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M3.5 9.6h17M8 3v3.6M16 3v3.6" stroke={color} strokeWidth={strokeWidth} {...base} />
    {[8.8, 12, 15.2].map((x) =>
      [13.3, 16.8].map((y) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={0.95} fill={color} />),
    )}
  </S>
);

export const DotsIcon = ({ color, size }: P) => (
  <S size={size}>
    {[5, 12, 19].map((x) => (
      <Circle key={x} cx={x} cy={12} r={1.7} fill={color} />
    ))}
  </S>
);

/** 메모 입력(휴대폰 입력창의 메모 모드): 세로로 긴 종이 + 짧은 가로줄 3개. 할 일의 체크 상자와 같은 크기·굵기(연필·말풍선 모양은 쓰지 않는다) */
export const MemoNoteIcon = ({ color, size, strokeWidth = 1.8 }: P) => (
  <S size={size}>
    <Rect x={4.5} y={3.5} width={15} height={17} rx={2.6} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M8.3 9h7.4M8.3 12.5h7.4M8.3 16h4.4" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const CheckSquareIcon = ({ color, size, strokeWidth = 1.8 }: P) => (
  <S size={size}>
    <Rect x={3.5} y={3.5} width={17} height={17} rx={2.6} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M7.8 12.4l2.9 2.9 5.6-6.1" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const PlusIcon = ({ color, size, strokeWidth = 1.8 }: P) => (
  <S size={size}>
    <Path d="M12 4.5v15M4.5 12h15" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** 반복(사용자가 준 아이콘): 위는 오른쪽, 아래는 왼쪽으로 가는 두 화살표, 바깥 모서리만 둥글게 */
export const RepeatIcon = ({ color, size, strokeWidth = 1.8 }: P) => (
  <S size={size}>
    <Path d="M3.95 12V10.25a1.9 1.9 0 0 1 1.9-1.9H19.9" stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M18 6.4l2.05 1.95L18 10.3" stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M20.1 12.05v1.7a1.9 1.9 0 0 1-1.9 1.9H4.1" stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M6.05 13.7L4 15.65l2.05 1.95" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** 할 일 동그라미(PC 창): 테두리 대신 그려서 화면 배율과 상관없이 선 두께가 고르고 둥글다 */
export const RingIcon = ({ color, size = 24, strokeWidth = 1.6 }: P) => (
  <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    <Circle cx={size / 2} cy={size / 2} r={(size - strokeWidth) / 2} stroke={color} strokeWidth={strokeWidth} fill="none" />
  </Svg>
);

/**
 * 반복 할 일 동그라미: 빈 동그라미(RingIcon)와 같은 크기·굵기의 테두리를 시계 방향으로 도는 두 곡선 화살표로 나눈다(가운데는 비움).
 * 화살 하나 = 호 138° + 작은 삼각 화살촉. 화살촉 끝과 다음 호 사이를 비워 두 화살로 읽히게(사용자 시안 2026-10-18).
 * 위젯(naegirok_check_repeat.xml, Widgets.swift RepeatRing)도 같은 모양이다.
 */
export const RepeatRingIcon = ({ color, size = 24, strokeWidth = 1.6 }: P) => {
  const c = size / 2;
  // 화살촉 밑변 반쪽(반지름 방향). 화살촉 바깥 끝까지 빈 동그라미(지름 size)와 같은 크기 안에 들게 원을 그만큼 안쪽에
  // (예전엔 화살촉이 테두리 밖으로 나와 빈 동그라미보다 커 보였다: 사용자 요청 2026-10-18)
  const half = Math.max(size * 0.09, strokeWidth * 1.3);
  const r = size / 2 - half;
  // 12시에서 시계 방향 각도(도) → 원 위의 점
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return [c + r * Math.sin(a), c - r * Math.cos(a)];
  };
  // 화살촉은 작게, 다만 선 굵기보다는 넉넉히 넓어야 화살로 보인다
  const head = Math.max(size * 0.17, strokeWidth * 2.3);
  const arrow = (from: number) => {
    const to = from + REPEAT_ARC;
    const [x0, y0] = at(from);
    const [x1, y1] = at(to);
    // 끝은 원을 따라 head만큼 앞(호의 곡률을 따른다), 밑변은 호 끝에서 반지름 방향으로 ±half
    const [tx, ty] = at(to + (head / r) * (180 / Math.PI));
    const a = (to * Math.PI) / 180;
    const nx = Math.sin(a) * half;
    const ny = -Math.cos(a) * half;
    return { arc: `M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}`, head: `M${tx} ${ty}L${x1 + nx} ${y1 + ny}L${x1 - nx} ${y1 - ny}Z` };
  };
  const top = arrow(220);
  const bottom = arrow(40);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Path d={top.arc} stroke={color} strokeWidth={strokeWidth} {...base} />
      <Path d={bottom.arc} stroke={color} strokeWidth={strokeWidth} {...base} />
      <Path d={top.head} fill={color} stroke={color} strokeWidth={strokeWidth * 0.35} strokeLinejoin="round" />
      <Path d={bottom.head} fill={color} stroke={color} strokeWidth={strokeWidth * 0.35} strokeLinejoin="round" />
    </Svg>
  );
};
/** 화살 하나의 호 길이(도). 두 화살 + 두 화살촉 + 두 틈 = 360° */
const REPEAT_ARC = 138;

/**
 * 완료한 반복 할 일의 채운 동그라미 안 표시(사용자 시안 2026-10-19): 시계 방향으로 도는 가는 두 곡선 화살표,
 * 화살촉은 꺾쇠로 오른쪽 위·왼쪽 아래에서 끝난다(흔히 쓰는 '새로 고침' 모양). 빈 반복 동그라미(RepeatRingIcon)의
 * 채운 삼각 화살촉은 이 크기에서 뭉개져 화살로 읽히지 않았다.
 */
export const RepeatGlyphIcon = ({ color, size, strokeWidth = 2.2 }: P) => (
  <S size={size}>
    <Path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5" stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const CheckIcon = ({ color, size, strokeWidth = 2.6 }: P) => (
  <S size={size}>
    <Path d="M5 12.5l4.5 4.5L19 7.5" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const ArrowUpIcon = ({ color, size, strokeWidth = 2.3 }: P) => (
  <S size={size}>
    <Path d="M12 19V5.5M6.5 11L12 5.5 17.5 11" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const ChevronIcon = ({ color, size, strokeWidth = 2, dir = 'right' }: P & { dir?: 'left' | 'right' | 'down' }) => (
  <S size={size}>
    <Path
      d={dir === 'right' ? 'M9.5 5.5L16 12l-6.5 6.5' : dir === 'left' ? 'M14.5 5.5L8 12l6.5 6.5' : 'M5.5 9.5L12 16l6.5-6.5'}
      stroke={color}
      strokeWidth={strokeWidth}
      {...base}
    />
  </S>
);

/** 펼치기(작게 접은 미니창을 다시 크게): 바깥으로 벌어지는 두 화살표 */
export const ExpandIcon = ({ color, size, strokeWidth = 1.8 }: P) => (
  <S size={size}>
    <Path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** 줄이기(미니창 위쪽을 한 줄로): 안으로 모이는 두 화살표 */
export const CollapseIcon = ({ color, size, strokeWidth = 1.8 }: P) => (
  <S size={size}>
    <Path d="M4 14h6v6M20 10h-6V4M14 10l6.5-6.5M10 14l-6.5 6.5" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const CloseIcon = ({ color, size, strokeWidth = 2 }: P) => (
  <S size={size}>
    <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** 압정(시안: 똑바로 선 모양 - 머리·허리·넓은 받침, 아래 바늘) */
export const PinIcon = ({ color, size, filled }: P & { filled?: boolean }) => (
  <S size={size}>
    <Path
      d="M9 3h6a1 1 0 0 1 .8 1.6L14.5 6.5v3.2c0 1.6 1.2 2.6 2.6 3.4.6.4.9.9.9 1.4H6c0-.5.3-1 .9-1.4 1.4-.8 2.6-1.8 2.6-3.4V6.5L8.2 4.6A1 1 0 0 1 9 3z"
      stroke={color}
      strokeWidth={1.6}
      {...base}
      fill={filled ? color : 'none'}
    />
    <Path d="M12 14.5V21" stroke={color} strokeWidth={1.6} {...base} />
  </S>
);

export const SearchIcon = ({ color, size, strokeWidth = 1.9 }: P) => (
  <S size={size}>
    <Circle cx={10.5} cy={10.5} r={6.5} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M15.5 15.5L20 20" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const PeopleIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Circle cx={9} cy={8.5} r={3.3} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5M15.5 5.6a3.2 3.2 0 0 1 0 6M17.5 14.3c1.8.6 3 2.2 3.5 4.7" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const BellIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const GlobeIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const LockIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Rect x={5} y={10.5} width={14} height={10} rx={2.2} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const TrashIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** 정보(동그라미 안 i): 할 일을 오른쪽으로 밀 때 */
export const InfoIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M12 11v5.2" stroke={color} strokeWidth={strokeWidth + 0.3} {...base} />
    <Circle cx={12} cy={7.9} r={1.1} fill={color} />
  </S>
);

export const BoxIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Path d="M4 7.5L12 3.5l8 4v9l-8 4-8-4zM4 7.5l8 4 8-4M12 11.5v9" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const HelpIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.8c0 1.8-2.4 2-2.4 3.8" stroke={color} strokeWidth={strokeWidth} {...base} />
    <Circle cx={12} cy={16.9} r={1} fill={color} />
  </S>
);

export const ShareIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Path d="M12 3.5v11M8 7.5l4-4 4 4M6 11.5H5.5v8h13v-8H18" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const FolderIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const EditIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Path d="M4 20h4l10.5-10.5-4-4L4 16zM13 7l4 4" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** 설정의 '내 계정': 동그라미 안 사람 */
export const PersonCircleIcon = ({ color, size, strokeWidth = 1.6 }: P) => (
  <S size={size}>
    <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Circle cx={12} cy={9.6} r={3.1} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M6.6 17.6c1.3-2 3.2-3 5.4-3s4.1 1 5.4 3" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** 사람(공유 목록의 동그라미 안) */
export const PersonIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Circle cx={12} cy={8.4} r={3.6} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M5 19.5c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** 꾸미기: 손잡이 달린 가로줄 세 개 */
export const SlidersIcon = ({ color, size, strokeWidth = 1.6 }: P) => (
  <S size={size}>
    <Path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" stroke={color} strokeWidth={strokeWidth} {...base} />
    <Circle cx={8.5} cy={6.5} r={2} stroke={color} strokeWidth={strokeWidth} />
    <Circle cx={15.5} cy={12} r={2} stroke={color} strokeWidth={strokeWidth} />
    <Circle cx={10} cy={17.5} r={2} stroke={color} strokeWidth={strokeWidth} />
  </S>
);

/** 위젯 설정: 둥근 네모 안 위젯 배치 */
export const WidgetBoxIcon = ({ color, size, strokeWidth = 1.6 }: P) => (
  <S size={size}>
    <Rect x={3.5} y={3.5} width={17} height={17} rx={3.5} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M9 7.5v9M9 12h3.5a2 2 0 0 1 2 2v2.5" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** 링크 */
export const LinkIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/**
 * 미니 메모 열기(팝아웃): 오른쪽 위 모서리가 열린 창 + 그 모서리에서 바깥으로 나가는 화살표.
 * 예전 '겹친 네모 두 개'는 복사·창 복원처럼 보였다. 그림은 4~20 안(검색·공유 아이콘과 같은 크기, 가운데 정렬)
 */
/** PC(모니터) */
export const MonitorIcon = ({ color, size, strokeWidth = 1.7 }: P) => (
  <S size={size}>
    <Rect x={3} y={4.5} width={18} height={12} rx={2.2} stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M9 20h6M12 16.5V20" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

export const PopOutIcon = ({ color, size, strokeWidth = 1.8 }: P) => (
  <S size={size}>
    <Path d="M19 13.5v4.1a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 17.6V7.4A2.4 2.4 0 0 1 6.4 5h4.1" stroke={color} strokeWidth={strokeWidth} {...base} />
    <Path d="M14.5 4H20v5.5M20 4l-7.5 7.5" stroke={color} strokeWidth={strokeWidth} {...base} />
  </S>
);

/** Google 로그인 버튼의 네 색 G(Google 브랜딩 가이드의 표준 로고, 색을 바꾸지 않는다) */
export const GoogleIcon = ({ size = 20 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 48 48">
    <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </Svg>
);

/** 카카오 로그인 버튼의 말풍선(카카오 디자인 가이드: 노란 바탕 위 검은 심볼) */
export const KakaoIcon = ({ color, size }: P) => (
  <S size={size}>
    <Path d="M12 4C7 4 3 7.1 3 11c0 2.5 1.7 4.7 4.2 6l-1 3.7c-.1.3.3.6.6.4l4.4-2.9c.3 0 .5.1.8.1 5 0 9-3.1 9-7s-4-7.3-9-7.3z" fill={color} />
  </S>
);
