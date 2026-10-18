// 분수 인덱스(문자열 정렬 키). 두 키 사이에 항상 새 키를 만들 수 있어
// 끌어서 순서를 바꿔도 옮긴 항목 하나만 고치면 된다. 기기 간 동기화에서도 충돌이 적다.
// 같은 알고리즘이 Kotlin(빠른 추가·위젯, Frac.kt)에도 있다. 바꾸면 같이 바꿀 것.
//
// 키 = 정수부 + 소수부. 정수부 첫 글자가 정수부 길이를 나타낸다(a=2자 … z=27자, Z=2자 … A=27자는 음수 쪽).
// 맨 뒤/맨 앞에 붙일 때는 정수부를 1씩 올리고 내려서 키 길이가 항목 수의 로그로만 는다.
// (예전에는 맨 뒤까지의 중간값을 써서 6개마다 한 글자씩 길어졌고, 1200개쯤 붙이면 서버 한도 200자를 넘었다)
// 예전 방식으로 만든 키('V', 'zzV' 같은)와 섞여도 문자열 비교 순서만 쓰므로 그대로 정렬된다.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const SMALLEST = 'A' + '0'.repeat(26);

function intLength(head: string): number | null {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2;
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2;
  return null;
}

/** 정수부 + 0으로 끝나지 않는 소수부로 된 키인지 */
function isValid(key: string): boolean {
  const n = intLength(key[0] ?? '');
  if (n === null || key.length < n || key === SMALLEST) return false;
  return key.length === n || !key.endsWith('0');
}

function increment(int: string): string | null {
  const digs = int.slice(1).split('');
  for (let i = digs.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d < BASE) {
      digs[i] = DIGITS[d];
      return int[0] + digs.join('');
    }
    digs[i] = '0';
  }
  // 자리 올림: 머리 글자를 다음으로(정수부 길이가 바뀐다)
  if (int[0] === 'Z') return 'a0';
  if (int[0] === 'z') return null;
  const head = String.fromCharCode(int.charCodeAt(0) + 1);
  if (head > 'a') digs.push('0');
  else digs.pop();
  return head + digs.join('');
}

function decrement(int: string): string | null {
  const digs = int.slice(1).split('');
  for (let i = digs.length - 1; i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d >= 0) {
      digs[i] = DIGITS[d];
      return int[0] + digs.join('');
    }
    digs[i] = 'z';
  }
  if (int[0] === 'a') return 'Zz';
  if (int[0] === 'A') return null;
  const head = String.fromCharCode(int.charCodeAt(0) - 1);
  if (head < 'Z') digs.push('z');
  else digs.pop();
  return head + digs.join('');
}

/**
 * a < 결과 < b 인 가장 짧은 쪽의 문자열(b = null이면 위로 끝없음). 결과는 0으로 끝나지 않는다.
 * b가 a 뒤에 0만 붙인 꼴이면 사이에 들어갈 문자열이 없어 null.
 */
function mid(a: string, b: string | null): string | null {
  if (b !== null) {
    let n = 0;
    while (n < b.length && (a[n] ?? '0') === b[n]) n++;
    if (n === b.length) return null;
    if (n > 0) {
      const rest = mid(a.slice(n), b.slice(n));
      return rest === null ? null : b.slice(0, n) + rest;
    }
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : BASE;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  // 첫 글자가 이웃이면 b의 첫 글자만으로 충분한지(b 뒤쪽이 전부 0이면 안 된다), 아니면 a 쪽으로 한 자리 더
  if (b !== null && /[^0]/.test(b.slice(1))) return b[0];
  return DIGITS[da] + mid(a.slice(1), null);
}

function intPart(key: string) {
  return key.slice(0, intLength(key[0])!);
}

/** a 바로 뒤 키(a = null이면 첫 키) */
function after(a: string | null): string {
  if (a === null) return 'a0';
  if (isValid(a)) {
    const ia = intPart(a);
    return increment(ia) ?? ia + mid(a.slice(ia.length), null)!;
  }
  // 예전 방식 키: a보다 큰 가장 작은 정수 키로 옮겨 탄다
  const n = intLength(a[0]);
  if (n === null) return increment(SMALLEST)!; // 숫자로 시작하는 키는 모든 정수 키보다 작다
  if (a.length < n) {
    const padded = a.padEnd(n, '0');
    return padded === SMALLEST ? increment(padded)! : padded;
  }
  return increment(a.slice(0, n)) ?? mid(a, null)!;
}

/** b 바로 앞 키 */
function before(b: string): string {
  if (isValid(b)) {
    const ib = intPart(b);
    if (ib === SMALLEST) return ib + mid('', b.slice(ib.length))!;
    if (ib < b) return ib;
    return decrement(ib) ?? mid('', b)!;
  }
  const n = intLength(b[0]);
  if (n === null) {
    // 숫자로 시작하는 키보다 작은 정수 키는 없다. '0…'이면 그 뒤에서 다시 정수 키를 내려 쓴다('0' + 키 < '0' + b).
    if (b[0] === '0' && b.length > 1) return '0' + before(b.slice(1));
    return mid('', b) ?? b;
  }
  const head = b.slice(0, n).padEnd(n, '0');
  if (head < b && head !== SMALLEST) return head;
  return (head === SMALLEST ? null : decrement(head)) ?? mid('', b) ?? b;
}

/** a와 b 사이 키. a=null이면 맨 앞, b=null이면 맨 뒤. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`frac: ${a} >= ${b}`);
  if (b === null) return after(a);
  if (a === null) return before(b);
  if (isValid(a) && isValid(b)) {
    const ia = intPart(a);
    const ib = intPart(b);
    if (ia === ib) return ia + mid(a.slice(ia.length), b.slice(ib.length))!;
    const i = increment(ia);
    if (i !== null && i < b) return i;
    return ia + mid(a.slice(ia.length), null)!;
  }
  // 사이가 없는 드문 경우(b = a + '0…')는 a 바로 뒤로(같은 키 순서는 id가 정한다)
  return mid(a, b) ?? mid(a, null)!;
}

export const compareKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** position, id 순 정렬(같은 키가 두 기기에서 동시에 생겨도 순서가 고정된다). */
export function byPosition<T extends { position: string; id: string }>(x: T, y: T) {
  return compareKey(x.position, y.position) || compareKey(x.id, y.id);
}
