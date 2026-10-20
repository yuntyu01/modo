import { keyBetween } from '../frac';

const KEY = /^[0-9A-Za-z]{1,200}$/; // 서버가 받는 정렬 키 형식(server/internal/api/sync.go keyRe)

test('키는 항상 두 키 사이에 들어간다', () => {
  // 무작위로 끼워 넣어도 정렬이 유지되는지
  let keys: string[] = [];
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 2000; i++) {
    const at = Math.floor(rand() * (keys.length + 1));
    const k = keyBetween(keys[at - 1] ?? null, keys[at] ?? null);
    keys.splice(at, 0, k);
  }
  const sorted = [...keys].sort();
  expect(keys).toEqual(sorted);
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.every((k) => KEY.test(k))).toBe(true);
});

test('맨 뒤·맨 앞에 계속 붙여도 키가 짧게 유지된다', () => {
  let last: string | null = null;
  let first: string | null = null;
  for (let i = 0; i < 10_000; i++) {
    const k = keyBetween(last, null);
    if (last) expect(k > last).toBe(true);
    last = k;
    const f = keyBetween(null, first);
    if (first) expect(f < first).toBe(true);
    first = f;
  }
  // 예전 방식은 1200개쯤에서 200자를 넘었다
  expect(last!.length).toBeLessThanOrEqual(4);
  expect(first!.length).toBeLessThanOrEqual(4);
});

test('예전 방식 키 뒤·앞에도 순서를 지키며 붙고, 그 뒤로는 짧게 유지된다', () => {
  for (const legacy of ['V', 'k', 'z', 'zV', 'zzzzzzzzzzk', '8', '0V', 'A', 'Zz', 'b0', 'a0V']) {
    let last = legacy;
    let first = legacy;
    for (let i = 0; i < 3000; i++) {
      const k = keyBetween(last, null);
      expect(k > last).toBe(true);
      last = k;
      const f = keyBetween(null, first);
      expect(f < first).toBe(true);
      first = f;
    }
    expect(last.length).toBeLessThanOrEqual(30);
    expect(KEY.test(last) && KEY.test(first)).toBe(true);
  }
});

test('예전 키와 새 키가 섞인 사이에도 끼워 넣을 수 있다', () => {
  const pairs: [string, string][] = [
    ['V', 'a0'],
    ['Zz', 'a0'],
    ['a0', 'a1'],
    ['a0', 'b'],
    ['k', 'k00000000001'],
    ['zV', 'zV00000000000000000000001'],
  ];
  for (const [a, b] of pairs) {
    let lo = a;
    for (let i = 0; i < 100; i++) {
      const k = keyBetween(lo, b);
      expect(k > lo && k < b).toBe(true);
      expect(k.endsWith('0') && k.length > 2 && !/^[a-zA-Z]/.test(k)).toBe(false);
      lo = k;
    }
  }
});
