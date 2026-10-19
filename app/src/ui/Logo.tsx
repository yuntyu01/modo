import { Image, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { BRAND } from '../brand';
import symbol from '../../assets/brand/symbol-path.json';

/**
 * 로고. 심볼은 사용자가 제공한 최신 이미지의 외곽선, 글자 modo는 기존 워드마크.
 * 기존 modo 워드마크의 높이·간격·아래 맞춤 배치는 유지한다.
 */
/** 동일한 닫힌 외곽선을 앱 로고·안내 그림·네이티브 위젯이 공유한다. */
export const MARK_PATH = { d: symbol.d, x: symbol.x, y: symbol.y, width: symbol.width, height: symbol.height };
const VB = `${MARK_PATH.x} ${MARK_PATH.y} ${MARK_PATH.width} ${MARK_PATH.height}`;
const ASPECT = MARK_PATH.width / MARK_PATH.height;
const WORD_ASPECT = 894 / 278;

export function Mark({ height, color = BRAND }: { height: number; color?: string }) {
  return (
    <Svg width={height * ASPECT} height={height} viewBox={VB}>
      <Path d={MARK_PATH.d} fill={color} />
    </Svg>
  );
}

/** 심볼 + modo. height = 글자(modo) 높이 */
/** markRatio: 심볼 높이 / 글자 높이(로고 파일은 201/266, 앱 머리 시안은 0.83) */
/** wordStretch: 글자 가로 배율(앱 머리 시안은 로고 파일보다 약 6% 넓다) */
export function Logo({
  height,
  color,
  markColor,
  markRatio = 201 / 266,
  wordStretch = 1,
}: {
  height: number;
  color: string;
  markColor?: string;
  markRatio?: number;
  wordStretch?: number;
}) {
  const markH = height * markRatio;
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="modo" style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <Mark height={markH} color={markColor} />
      <Image
        source={require('../../assets/brand/modo-wordmark.png')}
        style={{ width: height * WORD_ASPECT * wordStretch, height, marginLeft: (height * 83) / 266, tintColor: color }}
        resizeMode="stretch"
      />
    </View>
  );
}
