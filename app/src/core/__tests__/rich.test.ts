import {
  allMarked,
  applyPlainEdit,
  escapePlain,
  linkifyRuns,
  linkOf,
  marksForInsert,
  normalizeUrl,
  parseRich,
  plainOf,
  serializeRich,
  setLink,
  splitRunsByLine,
  toggleMark,
  toPlain,
  type Run,
} from '../rich';

const round = (src: string) => serializeRich(parseRich(src));

describe('글 꾸미기 저장 형식', () => {
  it('꾸미지 않은 글은 그대로다(예전 글·위젯이 쓴 글)', () => {
    for (const s of ['', '장보기', '3시~5시 회의 ~~', 'a < b && c > d', '<div>', 'x &gt; y', '**별표**', 'https://a.com/?q=1&r=2']) {
      expect(parseRich(s)).toEqual(s ? [{ text: s }] : []);
      expect(round(s)).toBe(s);
      expect(toPlain(s)).toBe(s);
    }
  });

  it('굵게·밑줄·취소선·링크를 읽고 다시 쓴다', () => {
    const src = '오늘 <b>꼭</b> <u>밑줄</u> <s>취소</s> <a href="https://naver.com">네이버</a>';
    expect(parseRich(src)).toEqual([
      { text: '오늘 ' },
      { text: '꼭', b: true },
      { text: ' ' },
      { text: '밑줄', u: true },
      { text: ' ' },
      { text: '취소', s: true },
      { text: ' ' },
      { text: '네이버', href: 'https://naver.com' },
    ]);
    expect(round(src)).toBe(src);
    expect(toPlain(src)).toBe('오늘 꼭 밑줄 취소 네이버');
  });

  it('겹친 꾸밈은 바르게 겹쳐 쓴다', () => {
    const runs: Run[] = [
      { text: 'a', b: true },
      { text: 'b', b: true, u: true },
      { text: 'c', u: true, href: 'https://x.y' },
      { text: 'd' },
    ];
    const s = serializeRich(runs);
    expect(s).toBe('<b>a<u>b</u></b><a href="https://x.y"><u>c</u></a>d');
    expect(parseRich(s)).toEqual(runs);
  });

  it('태그처럼 보이는 글자는 바꿔 적어 글자 그대로 돌아온다', () => {
    for (const text of ['<b>굵게 아님</b>', '&lt;', '&amp;lt;', '<a href="x">', '</a>', '<s', 'a&b']) {
      const runs = [{ text }];
      const s = serializeRich(runs);
      expect(parseRich(s)).toEqual(runs);
      expect(escapePlain(text)).toBe(s);
    }
    expect(escapePlain('<b>x')).toBe('&lt;b>x');
    expect(escapePlain('a < b')).toBe('a < b');
  });

  it('짝이 없는 닫는 태그·허락하지 않는 주소는 글자만', () => {
    expect(parseRich('a</b>c')).toEqual([{ text: 'a</b>c' }]);
    expect(parseRich('<a href="javascript:alert(1)">x</a>')).toEqual([{ text: 'x' }]);
    expect(parseRich('<b>끝까지')).toEqual([{ text: '끝까지', b: true }]);
  });
});

describe('편집', () => {
  const base: Run[] = [{ text: '가나' }, { text: '다라', b: true }, { text: '링크', href: 'https://a.com' }, { text: '끝' }];

  it('굵은 글 안·끝에 쓰면 굵게, 링크 끝에 이어 쓰면 링크가 아니다', () => {
    expect(marksForInsert(base, 3)).toEqual({ b: true });
    expect(marksForInsert(base, 4)).toEqual({ b: true });
    expect(marksForInsert(base, 5)).toEqual({ href: 'https://a.com' });
    expect(marksForInsert(base, 6)).toEqual({});
    expect(marksForInsert(base, 0)).toEqual({});
  });

  it('새 글을 받아 꾸밈을 지킨다(선택 위치를 알면 그 자리로)', () => {
    const typed = applyPlainEdit(base, '가나다X라링크끝', { start: 3, end: 3 });
    expect(serializeRich(typed)).toBe('가나<b>다X라</b><a href="https://a.com">링크</a>끝');
    const deleted = applyPlainEdit(base, '가나다링크끝');
    expect(serializeRich(deleted)).toBe('가나<b>다</b><a href="https://a.com">링크</a>끝');
    // 같은 글자가 이어진 곳: 선택 위치로 앞 글자의 꾸밈을 따른다
    const rep: Run[] = [{ text: 'a', b: true }, { text: 'a' }];
    expect(serializeRich(applyPlainEdit(rep, 'aaa', { start: 1, end: 1 }))).toBe('<b>aa</b>a');
    expect(serializeRich(applyPlainEdit(rep, 'aaa', { start: 2, end: 2 }))).toBe('<b>a</b>aa');
  });

  it('굵게 켜고 끄기, 링크 넣고 빼기', () => {
    let r = toggleMark(base, 0, 4, 'b');
    expect(serializeRich(r)).toBe('<b>가나다라</b><a href="https://a.com">링크</a>끝');
    expect(allMarked(r, 0, 4, 'b')).toBe(true);
    r = toggleMark(r, 1, 3, 'b');
    expect(serializeRich(r)).toBe('<b>가</b>나다<b>라</b><a href="https://a.com">링크</a>끝');
    r = setLink(r, 6, 7, 'https://b.com');
    expect(linkOf(r, 6, 7)).toBe('https://b.com');
    r = setLink(r, 4, 6, null);
    expect(toPlain(serializeRich(r))).toBe('가나다라링크끝');
    expect(serializeRich(r)).toBe('<b>가</b>나다<b>라</b>링크<a href="https://b.com">끝</a>');
  });

  it('줄바꿈으로 문단을 나눠도 꾸밈은 따라간다', () => {
    const parts = splitRunsByLine([{ text: '앞\n뒤', b: true }, { text: '!' }]);
    expect(parts.map(serializeRich)).toEqual(['<b>앞</b>', '<b>뒤</b>!']);
  });
});

describe('주소', () => {
  it('넣은 주소를 링크로', () => {
    expect(normalizeUrl('naver.com')).toBe('https://naver.com');
    expect(normalizeUrl(' https://a.com/x?y="1" ')).toBe('https://a.com/x?y=%221%22');
    expect(normalizeUrl('www.a.co.kr/path')).toBe('https://www.a.co.kr/path');
    expect(normalizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    for (const bad of ['', '그냥 글', '3.5', 'javascript:alert(1)', 'https://', 'a b.com']) expect(normalizeUrl(bad)).toBeNull();
  });

  it('주소처럼 생긴 글은 보여 줄 때 링크로(문장부호는 빼고)', () => {
    const runs = linkifyRuns([{ text: '여기 https://a.com/x(1)). 그리고 www.b.com, 끝' }]);
    expect(runs.filter((r) => r.href).map((r) => [r.text, r.href])).toEqual([
      ['https://a.com/x(1)', 'https://a.com/x(1)'],
      ['www.b.com', 'https://www.b.com'],
    ]);
    expect(plainOf(runs)).toBe('여기 https://a.com/x(1)). 그리고 www.b.com, 끝');
  });
});
