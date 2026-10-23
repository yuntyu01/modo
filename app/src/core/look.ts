// 꾸미기 중 계정으로 맞추는 것(사용자 요청 2026-10-24): 휴대폰에서 PC 미니창을, PC에서 홈·잠금 위젯을 고칠 수 있게
// 화면 · 홈 위젯 · 잠금 위젯 · PC 미니창 설정을 한 벌로 서버에 둔다(GET/PUT /api/me/look).
// 항목마다 바꾼 시각을 두어 늦게 바꾼 쪽이 이긴다: 통째로 덮으면 위젯을 써 본 적 없는 PC의 기본 위젯 설정이 휴대폰 것을 지웠다.
// 테마색은 따로(/api/me/theme: 인기 색 집계에도 쓴다). 휴대폰 앱(AppContext)과 PC 메인(desktop/sync-host.cjs)이 같이 쓴다.

/** 맞추는 꾸미기 항목. 언어 · 서버 · 잠금화면 알림 켜기처럼 기기에 딸린 설정은 뺀다(잠금화면에 보이는 내용만 'lock' = lock.visibility) */
export const LOOK_KEYS = ['themeMode', 'gradient', 'card', 'checkSide', 'font', 'weight', 'size', 'widget', 'lockWidget', 'mini', 'logoAccent', 'lock'] as const;

type Prefsish = Record<string, unknown> & { lock?: Record<string, unknown>; lookAts?: Record<string, number> };
/** 꾸미기 한 벌: 항목 값(v)과 그 항목을 바꾼 시각(at, 밀리초) */
export type LookBlob = { v: Record<string, unknown>; at: Record<string, number> };

function valueOf(prefs: Prefsish, k: string): unknown {
  if (k !== 'lock') return prefs[k];
  return prefs.lock?.visibility !== undefined ? { visibility: prefs.lock.visibility } : undefined;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 이 기기의 꾸미기(바꾼 시각이 있는 항목만: 손대지 않은 기본값으로 다른 기기 것을 덮지 않게) */
export function localLook(prefs: Prefsish): LookBlob {
  const ats = prefs.lookAts ?? {};
  const out: LookBlob = { v: {}, at: {} };
  for (const k of LOOK_KEYS) {
    const v = valueOf(prefs, k);
    if ((ats[k] ?? 0) > 0 && v !== undefined) {
      out.v[k] = v;
      out.at[k] = ats[k];
    }
  }
  return out;
}

/** 서버에서 받은 꾸미기가 맞는 모양인지(아니면 없는 것으로) */
export function asLook(x: unknown): LookBlob | null {
  const o = x as LookBlob | null;
  return o && typeof o === 'object' && o.v && typeof o.v === 'object' && o.at && typeof o.at === 'object' ? o : null;
}

/**
 * 항목마다 늦게 바꾼 쪽. apply = 계정 것이 늦어 이 기기에 들일 항목, merged = 합친 한 벌, push = 합친 것을 올려야 하는지
 */
export function mergeLook(local: LookBlob, remote: LookBlob | null) {
  const r = remote ?? { v: {}, at: {} };
  const merged: LookBlob = { v: { ...r.v }, at: { ...r.at } };
  const apply: LookBlob = { v: {}, at: {} };
  let push = false;
  for (const k of LOOK_KEYS) {
    const la = local.at[k] ?? 0;
    const ra = r.at[k] ?? 0;
    if (la > ra && k in local.v) {
      merged.v[k] = local.v[k];
      merged.at[k] = la;
      push = true;
    } else if (ra > la && k in r.v) {
      apply.v[k] = r.v[k];
      apply.at[k] = ra;
    }
  }
  return { merged, apply, push };
}

/** 계정에서 받은 항목을 설정 위에(그 항목을 바꾼 시각도 같이: 다시 올리지 않게) */
export function applyLook<T extends Prefsish>(prefs: T, look: LookBlob): T {
  const next: Prefsish = { ...prefs, lookAts: { ...(prefs.lookAts ?? {}) } };
  for (const [k, v] of Object.entries(look.v)) {
    if (!(LOOK_KEYS as readonly string[]).includes(k)) continue;
    if (k === 'lock') next.lock = { ...(prefs.lock ?? {}), visibility: (v as { visibility?: unknown } | null)?.visibility };
    else next[k] = v;
    next.lookAts![k] = look.at[k] ?? 0;
  }
  return next as T;
}

/** 설정을 바꿀 때: 값이 바뀐 꾸미기 항목에 바꾼 시각을 남긴 lookAts(바뀐 것이 없으면 null) */
export function stampLook(prev: Prefsish, patch: Prefsish, now: number): Record<string, number> | null {
  const after: Prefsish = { ...prev, ...patch };
  let ats: Record<string, number> | null = null;
  for (const k of LOOK_KEYS) {
    if (!(k in patch) || same(valueOf(prev, k), valueOf(after, k))) continue;
    ats = ats ?? { ...(prev.lookAts ?? {}) };
    ats[k] = now;
  }
  return ats;
}

/**
 * 바꾼 시각을 두기 전 설정: 기본값과 다른 항목은 아주 이른 시각(1)으로 둔다. 계정에 아직 없으면 올라가고(다른 기기에서 보이게),
 * 다른 기기에서 그 뒤에 바꾼 것이 있으면 그것을 따른다
 */
export function seedLookAts(saved: Prefsish, defaults: Prefsish): Record<string, number> {
  const ats: Record<string, number> = {};
  for (const k of LOOK_KEYS) {
    const v = valueOf(saved, k);
    if (v !== undefined && !same(v, valueOf(defaults, k))) ats[k] = 1;
  }
  return ats;
}
