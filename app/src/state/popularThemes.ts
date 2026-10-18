import { BRAND } from '../brand';
import type { Repo } from '../core/repo';
import { api } from '../core/sync';
import { ACCENTS, MAIN_ACCENTS } from './prefs';

/** 서버가 세는 인기 테마색: 지금 그 색을 쓰는 계정 수(계정당 한 표). 이 기기는 하루에 한 번만 새로 받는다. */
export type Popular = { day: string; total: number; themes: { id: string; users: number }[] };

/** 이만큼 쌓이기 전에는 정해 둔 추천색을 보여 준다 */
export const POPULAR_MIN_TOTAL = 30;
/** 추천에 넣을 색은 적어도 이만큼은 쓰여야 한다 */
export const POPULAR_MIN_USERS = 3;

/** 하루 한 번: 오늘 받은 게 있으면 그대로, 아니면 서버에서 받아 기억한다(못 받으면 예전 것). */
export async function loadPopular(repo: Repo, server: string, today: string): Promise<Popular | null> {
  const cached = await repo.getKv<Popular | null>('popular_themes', null);
  if (cached?.day === today) return cached;
  try {
    const r = await api<{ total: number; themes: { id: string; users: number }[] }>(fetch, server, '/api/themes/popular');
    const next: Popular = { day: today, total: r.total, themes: r.themes };
    await repo.write(() => repo.setKv('popular_themes', next));
    return next;
  } catch {
    return cached;
  }
}

/**
 * 설정 첫 화면의 추천 4색: 맨 앞은 늘 기본 하늘색(대표색), 나머지 셋은 인기색(데이터가 충분할 때, 앱 색 목록에 있는 것만).
 * 모자라면 정해 둔 추천색(꾸미기 첫 화면의 라벤더·세이지·살구)으로 채운다.
 */
export function recommendedAccents(popular: Popular | null): string[] {
  const picks = MAIN_ACCENTS.slice(1, 4);
  const palette = new Set([...ACCENTS, ...MAIN_ACCENTS].map((c) => c.toUpperCase()));
  const top =
    popular && popular.total >= POPULAR_MIN_TOTAL
      ? popular.themes.filter((t) => t.users >= POPULAR_MIN_USERS && t.id !== BRAND && palette.has(t.id.toUpperCase())).map((t) => t.id.toUpperCase())
      : [];
  const rest = [...top.slice(0, 3)];
  for (const c of picks) if (rest.length < 3 && !rest.includes(c)) rest.push(c);
  return [BRAND, ...rest];
}

/** 지금 쓰는 색은 순위와 상관없이 늘 보이게: 추천에 없으면 마지막 자리를 그 색으로 */
export function withCurrent(list: string[], current: string): string[] {
  const c = current.toUpperCase();
  return list.includes(c) ? list : [...list.slice(0, list.length - 1), c];
}
