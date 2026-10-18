import { Image, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { BRAND } from '../brand';

/**
 * 로고. 심볼(m + 체크)은 받은 로고를 선 경로로 다시 그린 벡터, 글자 modo는 받은 로고에서 오린 이미지.
 * 배치(심볼 높이 : 글자 높이 : 사이 = 201 : 266 : 83, 아래 맞춤)도 받은 로고와 같다.
 */
const D = 'M124.5 794.5V764.5A173.5 173.5 0 0 1 471.5 764.5V796.2M496 796.2V764.5A173.5 173.5 0 0 1 843 764.5V779.5L883 798L1127.5 511.5';
const VB = '51.8 438.8 1148.5 432';
const ASPECT = 2.6586;
const WORD_ASPECT = 894 / 278;

export function Mark({ height, color = BRAND }: { height: number; color?: string }) {
  return (
    <Svg width={height * ASPECT} height={height} viewBox={VB}>
      <Path d={D} stroke={color} strokeWidth={145.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
