import { applyLook, localLook, mergeLook, seedLookAts, stampLook } from '../look';

const base = {
  size: 'm',
  checkSide: 'right',
  widget: { linked: true, accent: '#85ADE2', card: null, opacity: 0.4 },
  mini: { linked: true, accent: '#85ADE2', card: null, opacity: 0.8 },
  lock: { enabled: true, visibility: 'private' },
  language: 'ko',
};

test('꾸미기는 항목마다 바꾼 시각을 남기고, 손대지 않은 항목은 올리지 않는다', () => {
  const ats = stampLook({ ...base, lookAts: {} }, { mini: { ...base.mini, opacity: 0.5 }, language: 'en' }, 100);
  // 언어는 기기 설정이라 맞추지 않는다
  expect(ats).toEqual({ mini: 100 });
  expect(stampLook(base, { mini: base.mini }, 100)).toBeNull(); // 같은 값
  const local = localLook({ ...base, mini: { ...base.mini, opacity: 0.5 }, lookAts: ats! });
  expect(local).toEqual({ v: { mini: { ...base.mini, opacity: 0.5 } }, at: { mini: 100 } });
  // 잠금화면은 보이는 내용만(알림 켜기는 기기 설정)
  const lockAts = stampLook(base, { lock: { enabled: false, visibility: 'secret' } }, 7)!;
  expect(localLook({ ...base, lock: { enabled: false, visibility: 'secret' }, lookAts: lockAts }).v).toEqual({ lock: { visibility: 'secret' } });
});

test('휴대폰에서 고친 PC 미니창과 PC에서 고친 위젯이 서로 덮지 않고 합쳐진다', () => {
  // 휴대폰: 미니창을 10에 고침. PC: 위젯을 20에 고침(서버에는 PC 것이 먼저 올라가 있다)
  const phone = { v: { mini: { opacity: 0.5 } }, at: { mini: 10 } };
  const server = { v: { widget: { opacity: 0.9 } }, at: { widget: 20 } };
  const m = mergeLook(phone, server);
  expect(m.push).toBe(true);
  expect(m.merged).toEqual({ v: { widget: { opacity: 0.9 }, mini: { opacity: 0.5 } }, at: { widget: 20, mini: 10 } });
  expect(m.apply).toEqual({ v: { widget: { opacity: 0.9 } }, at: { widget: 20 } });
  // 같은 항목은 늦게 바꾼 쪽
  const later = mergeLook({ v: { size: 'l' }, at: { size: 30 } }, { v: { size: 's' }, at: { size: 40 } });
  expect([later.push, later.apply.v.size]).toEqual([false, 's']);
  // 서버에 아직 없으면 이 기기 것을 올린다
  expect(mergeLook(phone, null).push).toBe(true);
});

test('받은 항목은 설정 위에 시각과 함께(잠금화면 알림 켜기는 그대로)', () => {
  const next = applyLook(
    { ...base, lookAts: { size: 5 } },
    { v: { widget: { ...base.widget, opacity: 0.9 }, lock: { visibility: 'public' }, language: 'en' }, at: { widget: 20, lock: 21, language: 22 } },
  );
  expect(next.widget.opacity).toBe(0.9);
  expect(next.lock).toEqual({ enabled: true, visibility: 'public' });
  expect(next.language).toBe('ko'); // 맞추는 항목이 아니다
  expect(next.lookAts).toEqual({ size: 5, widget: 20, lock: 21 });
});

test('예전 설정은 기본값과 다른 항목만 아주 이른 시각(1)으로: 계정에 있으면 계정 것을 따른다', () => {
  const ats = seedLookAts({ ...base, size: 'l', mini: { ...base.mini, opacity: 0.3 } }, base);
  expect(ats).toEqual({ size: 1, mini: 1 });
  expect(mergeLook(localLook({ ...base, size: 'l', lookAts: ats }), { v: { size: 's' }, at: { size: 50 } }).apply.v).toEqual({ size: 's' });
});
