import { CodedError } from '../errors';
import { HttpError } from '../sync';
import { codeText, errorText, LANGS, translator } from '../../i18n';
import { dayTitle, describeRepeat, formatDate, monthTitle } from '../../ui/format';

test('모든 언어에 같은 키가 있고 자리표시자({n} 등)가 빠지지 않는다', () => {
  const ko = translator('ko');
  for (const lang of LANGS) {
    const t = translator(lang);
    expect(t('deleteFolderQ', { name: 'X' })).toContain('X');
    expect(t('err_request', { status: 503 })).toContain('503');
    expect(t('kakaoLogin')).not.toBe('');
    if (lang !== 'ko') expect(t('newTodo')).not.toBe(ko('newTodo'));
  }
});

test('날짜·반복 표기가 언어마다 나온다', () => {
  const d = '2026-10-17'; // 토요일
  expect(LANGS.map((l) => formatDate(d, l))).toEqual(['10월 17일 (토)', 'Sat, Oct 17', '10月17日(土)', '10月17日（周六）']);
  expect(LANGS.map((l) => dayTitle(d, l))).toEqual(['10월 17일 토요일', 'Saturday, Oct 17', '10月17日 土曜日', '10月17日 星期六']);
  expect(LANGS.map((l) => monthTitle(new Date(2026, 9, 1), l))).toEqual(['2026년 10월', 'Oct 2026', '2026年10月', '2026年10月']);
  const mwf = { freq: 'weekly' as const, days: 1 | 4 | 16 };
  expect(LANGS.map((l) => describeRepeat(mwf, l, null))).toEqual(['매주 월·수·금', 'Weekly Mon·Wed·Fri', '毎週 月·水·金', '每周一、三、五']);
  expect(LANGS.map((l) => describeRepeat({ freq: 'weekly', days: 8 }, l, null))).toEqual(['매주 목요일', 'Every Thursday', '毎週木曜日', '每星期四']);
});

test('서버·앱 오류 code는 사용자 언어로, 모르는 code는 받은 문구 그대로', () => {
  const ja = translator('ja');
  expect(errorText(new HttpError(409, '이미 가입된 이메일입니다', 'email_taken'), ja)).toBe(ja('err_email_taken'));
  expect(errorText(new HttpError(0, 'x', 'network'), translator('en'))).toBe("Can't reach the server");
  expect(errorText(new CodedError('kakao_unavailable', 'x'), translator('zh'))).toBe(translator('zh')('err_kakao_unavailable'));
  expect(codeText('something_new', '서버가 보낸 문구', ja)).toBe('서버가 보낸 문구');
  // code가 없던 예전 서버 응답도 상태 코드로 대신 정해 번역된다
  expect(errorText(new HttpError(500, 'boom'), translator('en'))).toBe(translator('en')('err_server'));
});
