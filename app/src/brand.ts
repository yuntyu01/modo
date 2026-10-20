/**
 * modo UI 대표색. 체크·선택 탭·보내기 버튼과 위쪽 그라데이션이 이 색에서 나온다.
 * 기본 로고는 아래 LOGO_BLUE를 사용하고 직접 고른 테마색은 로고 설정에 따라 적용한다.
 * 앱 아이콘·트레이·스플래시 그림은 별도로 제공된 원본 이미지의 색을 사용한다.
 * 기본 강조색을 바꾸면 JS를 읽지 못하는 휴대폰 위젯의 같은 값도 맞춘다.
 * src/__tests__/brand.test.ts가 서로 같은지 확인한다(위젯 쪽 값 위치는 그 테스트에 적어 둠).
 */
export const BRAND = '#85ADE2';

/** Approved symbol.svg fill; keep the logo distinct from the softer UI accent. */
export const LOGO_BLUE = '#82B4FB';
