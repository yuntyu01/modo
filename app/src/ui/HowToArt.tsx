import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { useUi } from '../state/AppContext';
import { MARK_PATH } from './Logo';
import type { Theme } from './theme';

/**
 * '직접 넣는 방법'(settings/howto) 단계 그림: 단순한 휴대폰 화면 위에 누를 곳(손가락)·끄는 방향(화살표)·강조를 그린다.
 * 기기마다 화면이 달라 스크린샷 대신 그림으로(테마색·다크/라이트를 따르고, 그림 안 글자도 앱 언어로).
 * 좌표는 120 × 220(휴대폰 하나) 기준.
 */
export type HowToKind = 'widget' | 'lock';

export const HOWTO_STEPS: Record<HowToKind, number> = { widget: 4, lock: 3 };

const W = 120;
const H = 220;
/** 위젯 그림 바탕(실제 홈 위젯과 같은 파란 기 없는 차콜) */
const WIDGET_BG = '#2A2A2C';

function palette(theme: Theme) {
  return {
    screen: theme.dark ? '#121316' : '#EEF1F5',
    frame: theme.dark ? '#3A3D44' : '#C5CBD4',
    block: theme.dark ? '#2B2E34' : '#D6DBE2',
    panel: theme.dark ? '#1E2024' : '#FFFFFF',
    line: theme.dark ? '#43474F' : '#C9CFD8',
    text: theme.text,
    muted: theme.muted,
    accent: theme.accent,
  };
}

/** modo 심볼(왼쪽 위 x, y, 높이 h) */
function markAt(x: number, y: number, h: number, color: string) {
  const s = h / MARK_PATH.height;
  return <Path d={MARK_PATH.d} transform={`translate(${x - MARK_PATH.x * s} ${y - MARK_PATH.y * s}) scale(${s})`} fill={color} />;
}

/**
 * 위젯 크기 고르기(설정 → 홈·잠금화면 → 홈 화면 위젯) 그림: 홈 화면 칸(가로 4칸) 위에서 위젯이 차지하는 크기를 대충 보여 준다
 * (사용자 요청 2026-10-21). 위젯 안 할 일 줄 수도 크기를 따라 늘어난다. 칸 크기는 런처·기기마다 달라 실제와 똑같지는 않다.
 */
export function WidgetSizeArt({ cells, width = 92 }: { cells: 3 | 4; width?: number }) {
  const { theme } = useUi();
  const c = palette(theme);
  const CELL = 24;
  const X0 = 12;
  const Y0 = 24;
  const ROWS = 6;
  const x = X0 + 2;
  const y = Y0 + 2;
  const side = cells * CELL - 4;
  const icons = [];
  for (let r = 0; r < ROWS; r++)
    for (let col = 0; col < 4; col++)
      if (r >= cells || col >= cells) icons.push(<Circle key={`${r}-${col}`} cx={X0 + col * CELL + CELL / 2} cy={Y0 + r * CELL + CELL / 2} r={7} fill={c.block} />);
  const rows: number[] = [];
  for (let ry = y + 21; ry + 6 < y + side - 3; ry += 11) rows.push(ry);
  return (
    <Svg width={width} height={(width * H) / W} viewBox={`0 0 ${W} ${H}`} accessible={false}>
      <Rect x={3} y={3} width={W - 6} height={H - 6} rx={16} fill={c.screen} stroke={c.frame} strokeWidth={2} />
      <Rect x={14} y={10} width={14} height={3} rx={1.5} fill={c.line} />
      <Rect x={88} y={10} width={18} height={3} rx={1.5} fill={c.line} />
      {icons}
      <Rect x={14} y={178} width={92} height={1} fill={c.line} />
      {[24, 48, 72, 96].map((cx) => (
        <Circle key={cx} cx={cx} cy={196} r={7} fill={c.block} />
      ))}
      <Rect x={x} y={y} width={side} height={side} rx={9} fill={WIDGET_BG} stroke={c.accent} strokeWidth={1.4} />
      {markAt(x + 6, y + 7, 4.5, theme.accent)}
      <Rect x={x + 22} y={y + 7.5} width={10} height={3.5} rx={1.75} fill="#F5F5F7" />
      <Rect x={x + 36} y={y + 7.5} width={10} height={3.5} rx={1.75} fill="#77787D" />
      {rows.map((ry, i) => (
        <G key={ry}>
          <Circle cx={x + 9} cy={ry + 1.75} r={2.6} fill="none" stroke="#9A9BA0" strokeWidth={1} />
          <Rect x={x + 16} y={ry} width={(side - 24) * (i % 2 ? 0.62 : 0.85)} height={3.5} rx={1.75} fill="#C9CACE" />
        </G>
      ))}
    </Svg>
  );
}

export function HowToArt({ kind, step, width = 104 }: { kind: HowToKind; step: number; width?: number }) {
  const { theme, t } = useUi();
  const c = palette(theme);

  /** 화면 틀과 위쪽 상태 표시줄 */
  const phone = (children: React.ReactNode, screen = c.screen) => (
    <Svg width={width} height={(width * H) / W} viewBox={`0 0 ${W} ${H}`} accessible={false}>
      <Rect x={3} y={3} width={W - 6} height={H - 6} rx={16} fill={screen} stroke={c.frame} strokeWidth={2} />
      <Rect x={14} y={10} width={14} height={3} rx={1.5} fill={c.line} />
      <Rect x={88} y={10} width={18} height={3} rx={1.5} fill={c.line} />
      {children}
    </Svg>
  );

  /** 누르는 곳: 테마색 점 + 퍼지는 고리(hold면 고리 두 겹 = 길게 누르기) */
  const finger = (x: number, y: number, hold = false) => (
    <G>
      {hold ? <Circle cx={x} cy={y} r={15} fill="none" stroke={c.accent} strokeOpacity={0.25} strokeWidth={2} /> : null}
      <Circle cx={x} cy={y} r={10} fill={c.accent} fillOpacity={0.22} stroke={c.accent} strokeOpacity={0.6} strokeWidth={1.5} />
      <Circle cx={x} cy={y} r={4.5} fill={c.accent} />
    </G>
  );

  /** 끄는 방향 화살표(점선 몸통 + 머리) */
  const arrow = (d: string, head: [number, number, number]) => {
    const [x, y, deg] = head;
    return (
      <G>
        <Path d={d} fill="none" stroke={c.accent} strokeWidth={2.2} strokeLinecap="round" strokeDasharray="4 4" />
        <Path
          d="M-5 -4 L0 0 L-5 4"
          transform={`translate(${x} ${y}) rotate(${deg})`}
          fill="none"
          stroke={c.accent}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    );
  };

  const mark = (x: number, y: number, h: number, color = c.accent) => markAt(x, y, h, color);

  /** 홈 위젯 모양(심볼 · 폴더 탭 · 메모 줄) */
  const widget = (x: number, y: number, w: number, h: number) => (
    <G>
      <Rect x={x} y={y} width={w} height={h} rx={8} fill={WIDGET_BG} />
      {mark(x + 6, y + 6, 4.5, theme.accent)}
      <Rect x={x + 22} y={y + 6.5} width={10} height={3.5} rx={1.75} fill="#F5F5F7" />
      <Rect x={x + 36} y={y + 6.5} width={10} height={3.5} rx={1.75} fill="#77787D" />
      <Rect x={x + 6} y={y + 17} width={w * 0.62} height={3.5} rx={1.75} fill="#C9CACE" />
      <Rect x={x + 6} y={y + 25} width={w * 0.78} height={3.5} rx={1.75} fill="#C9CACE" />
      {h > 36 ? <Rect x={x + 6} y={y + 33} width={w * 0.5} height={3.5} rx={1.75} fill="#C9CACE" /> : null}
    </G>
  );

  /** 홈 화면: 앱 아이콘 두 줄 + 아래 독 */
  const home = (
    <G>
      {[150, 172, 199].map((y) => [24, 48, 72, 96].map((x) => <Circle key={`${x}-${y}`} cx={x} cy={y} r={7} fill={c.block} />))}
      <Rect x={14} y={186} width={92} height={1} fill={c.line} />
    </G>
  );

  const label = (x: number, y: number, text: string, size = 8.5, color = c.text, anchor: 'start' | 'middle' = 'start', bold = false) => (
    <SvgText x={x} y={y} fontSize={size} fill={color} textAnchor={anchor} fontWeight={bold ? '700' : '400'}>
      {text}
    </SvgText>
  );

  if (kind === 'widget') {
    if (step === 0)
      return phone(
        <G>
          {home}
          {finger(60, 88, true)}
        </G>,
      );
    if (step === 1)
      return phone(
        <G>
          {home}
          <Rect x={30} y={60} width={78} height={62} rx={9} fill={c.panel} stroke={c.line} strokeWidth={1} />
          <Rect x={38} y={70} width={8} height={8} rx={2} fill={c.block} />
          <Rect x={52} y={72} width={40} height={4} rx={2} fill={c.line} />
          <Rect x={34} y={84} width={70} height={18} rx={6} fill={c.accent} fillOpacity={0.18} />
          <Rect x={38} y={89} width={8} height={8} rx={2} fill={c.accent} />
          {label(52, 96, t('artWidgets'), 9, c.text, 'start', true)}
          <Rect x={38} y={108} width={8} height={8} rx={2} fill={c.block} />
          <Rect x={52} y={110} width={34} height={4} rx={2} fill={c.line} />
          {finger(88, 93)}
        </G>,
      );
    if (step === 2)
      return phone(
        <G>
          <Rect x={3} y={36} width={W - 6} height={H - 39} rx={14} fill={c.panel} />
          <Rect x={50} y={42} width={20} height={3} rx={1.5} fill={c.line} />
          <Rect x={12} y={52} width={96} height={14} rx={7} fill={c.block} />
          {label(22, 62, 'modo', 8, c.muted)}
          {label(14, 84, 'modo', 9.5, c.text, 'start', true)}
          <Rect x={10} y={90} width={100} height={52} rx={10} fill={c.accent} fillOpacity={0.14} stroke={c.accent} strokeWidth={1.4} />
          {widget(18, 96, 84, 40)}
          {[156, 170, 184, 198].map((y) => (
            <Rect key={y} x={14} y={y} width={y % 28 ? 60 : 78} height={5} rx={2.5} fill={c.block} />
          ))}
          {arrow('M60 112 C60 80 60 46 60 24', [60, 22, -90])}
          {finger(60, 116, true)}
        </G>,
      );
    return phone(
      <G>
        {home}
        {widget(14, 26, 92, 58)}
        <Rect x={11} y={23} width={98} height={64} rx={10} fill="none" stroke={c.accent} strokeWidth={1.6} />
        {[
          [60, 23],
          [60, 87],
          [11, 55],
          [109, 55],
        ].map(([x, y]) => (
          <Circle key={`${x}-${y}`} cx={x} cy={y} r={3.2} fill={c.panel} stroke={c.accent} strokeWidth={1.6} />
        ))}
        <Rect x={28} y={98} width={64} height={18} rx={9} fill={c.panel} stroke={c.line} strokeWidth={1} />
        {label(60, 110.5, t('artWidgetSettings'), 8, c.text, 'middle')}
      </G>,
    );
  }

  // 잠금화면(삼성 One UI 기준, 사용자 요청 2026-10-21): 잠금화면을 길게 눌러 '위젯' → 목록에서 modo → 없으면 Good Lock LockStar
  if (step === 0)
    return phone(
      <G>
        {label(60, 64, '12:30', 26, c.text, 'middle', true)}
        <Rect x={38} y={74} width={44} height={4} rx={2} fill={c.line} />
        <Rect x={14} y={96} width={92} height={30} rx={10} fill={c.accent} fillOpacity={0.12} stroke={c.accent} strokeWidth={1.4} strokeDasharray="3 3" />
        {label(60, 115, t('artWidgets'), 9, c.text, 'middle', true)}
        <Rect x={55} y={186} width={10} height={9} rx={2} fill={c.line} />
        <Path d="M57 186 V183 A3 3 0 0 1 63 183 V186" fill="none" stroke={c.line} strokeWidth={1.6} />
        {finger(86, 111, true)}
      </G>,
    );
  if (step === 1)
    return phone(
      <G>
        <Rect x={3} y={60} width={W - 6} height={H - 63} rx={16} fill={c.panel} />
        <Rect x={50} y={68} width={20} height={3} rx={1.5} fill={c.line} />
        {label(14, 88, t('artWidgets'), 9, c.text, 'start', true)}
        {[100, 150, 172].map((y) => (
          <G key={y}>
            <Rect x={14} y={y} width={16} height={16} rx={4} fill={c.block} />
            <Rect x={36} y={y + 6} width={42} height={4} rx={2} fill={c.line} />
          </G>
        ))}
        <Rect x={10} y={122} width={100} height={22} rx={7} fill={c.accent} fillOpacity={0.16} stroke={c.accent} strokeWidth={1.4} />
        {mark(15, 129.5, 6)}
        {label(36, 137, 'modo', 8.5, c.text, 'start', true)}
        {finger(92, 133)}
      </G>,
    );
  return phone(
    <G>
      {label(14, 34, 'Good Lock', 9.5, c.text, 'start', true)}
      {[46, 92].map((y) => (
        <Rect key={y} x={10} y={y} width={100} height={20} rx={7} fill={c.block} />
      ))}
      <Rect x={10} y={69} width={100} height={20} rx={7} fill={c.accent} fillOpacity={0.16} stroke={c.accent} strokeWidth={1.4} />
      {label(16, 82, 'LockStar', 8.5, c.text, 'start', true)}
      <Rect x={86} y={74} width={18} height={10} rx={5} fill={c.accent} />
      <Circle cx={99} cy={79} r={3.6} fill={theme.onAccent} />
      {widget(14, 124, 92, 44)}
      {label(60, 186, t('artAddWidget'), 8, c.text, 'middle')}
    </G>,
  );
}
