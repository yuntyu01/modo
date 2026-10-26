import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { FriendsData, Person } from '../core/types';
import { desktop } from '../native/bridge';
import { useApp } from './AppContext';

export type { Friend, FriendFolder, FriendRequest, FriendsData } from '../core/types';

/** 검색 결과: 그 사람과의 지금 관계 */
export type FriendSearch = { user: Person; status: 'none' | 'friend' | 'outgoing' | 'incoming'; request_id?: string };
type RequestResult = { status: 'requested'; request: { id: string } };

type FriendsApi = {
  data: FriendsData;
  /** 이 계정의 친구 목록을 한 번이라도 받았는지(아니면 아직 동기화 전) */
  loaded: boolean;
  /** 동기화를 한 번 돌린다(친구·요청·공유 상태를 서버에서 다시 받는다) */
  refresh: () => Promise<void>;
  search: (email: string) => Promise<FriendSearch>;
  request: (email: string, userId?: string) => Promise<RequestResult>;
  accept: (id: string) => Promise<Person>;
  decline: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  /**
   * 내 폴더(여럿이면 모두)를 친구들에게 공유(사용자 id로: 이미 친구라 다시 수락을 묻지 않는다).
   * 내 전체(폴더 없는 할 일·메모)는 폴더 id 자리에 내 계정 id(서버가 baseShare일 때만, 사용자 요청 2026-10-26).
   * 이미 함께 쓰는 사람은 건너뛴다(모든 폴더를 공유할 때 일부 폴더는 이미 공유했을 수 있다)
   */
  shareFolder: (folderId: string | string[], userIds: string[], role: 'view' | 'edit') => Promise<void>;
  /** 새 공유 폴더: 만들고 바로 친구들에게 공유. 돌려주는 값: 새 폴더 id */
  createShared: (name: string, userIds: string[], role: 'view' | 'edit') => Promise<string>;
  /** 공유받은 폴더를 내 홈에 보일지(내 설정만) */
  setHome: (folderId: string, home: boolean) => Promise<void>;
  /** 공유 폴더 나가기(참여자만) */
  leave: (folderId: string) => Promise<void>;
};

const EMPTY: FriendsData = { friends: [], incoming: [], outgoing: [] };
type Cache = { account: string; digest: string; data: FriendsData } | null;

const FriendsCtx = createContext<FriendsApi | null>(null);

/** 이름이 없으면 이메일 앞부분 */
export function personName(p: Person) {
  return p.name.trim() || p.email.split('@')[0] || '?';
}

/** 시안의 '@harin': 이메일 앞부분(이메일이 없는 계정은 비움). 동명이인은 관리 화면에서 이메일 전체로 구분한다 */
export function personHandle(p: Person) {
  const local = p.email.split('@')[0];
  return local ? `@${local}` : '';
}

/**
 * 친구·받은 요청·보낸 요청과 친구별로 함께 쓰는 폴더. 서버가 관리하고 기존 동기화(pull)가 kv 'friends'에 받아 둔다:
 * 창마다 따로 묻지 않고, 인터넷이 없을 때도 마지막 목록을 보인다(폴더 내용은 늘 이 기기의 DB).
 * 요청 보내기·수락·권한 바꾸기는 서버가 받아들인 뒤에만 화면에 반영한다(성공한 것처럼 먼저 보이지 않는다).
 * 로그인한 화면(MainLayout) 안에서만 쓴다.
 */
export function FriendsProvider({ children }: { children: ReactNode }) {
  const { sync, repo, account, snap, t, showToast } = useApp();
  const accountId = account?.id ?? null;
  const [cache, setCache] = useState<Cache>(null);
  const data = cache && cache.account === accountId ? cache.data : EMPTY;
  const loaded = !!cache && cache.account === accountId;

  const reload = useCallback(async () => {
    setCache(await repo.getKv<Cache>('friends', null));
  }, [repo]);
  // 휴대폰: 동기화가 같은 프로세스에서 kv에 쓴다. PC 창: 메인이 동기화하고 'friends'가 바뀌면 알린다
  useEffect(() => {
    // 상태는 DB를 읽은 뒤에 바뀐다(컴파일러 규칙의 오탐)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    const off = repo.subscribe((_s, tables) => {
      if (tables.has('kv') || tables.has('*')) void reload();
    });
    const offDesk = desktop?.onDataChanged((tables) => {
      if (!tables || tables.includes('friends') || tables.includes('*')) void reload();
    });
    return () => {
      off();
      offDesk?.();
    };
  }, [repo, reload, accountId]);

  const refresh = useCallback(async () => {
    await sync.syncNow();
    await reload();
  }, [sync, reload]);

  // 새로 함께 쓰게 된 폴더(친구가 공유했거나 함께 참여)를 짧게 알린다. 처음 받은 목록은 알리지 않는다
  const seenRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!loaded || !accountId) return;
    let alive = true;
    void (async () => {
      const key = `friends_seen:${accountId}`;
      const pairs = data.friends.flatMap((f) => f.folders.filter((ff) => !ff.mine).map((ff) => ({ f, ff, k: `${f.id}:${ff.folder_id}` })));
      const saved = seenRef.current ?? new Set(await repo.getKv<string[] | null>(key, null) ?? pairs.map((p) => p.k));
      if (!alive) return;
      const fresh = pairs.filter((p) => !saved.has(p.k));
      const next = new Set(pairs.map((p) => p.k));
      seenRef.current = next;
      if (fresh.length) {
        const first = fresh[0];
        const folder = snap.folders.find((x) => x.id === first.ff.folder_id);
        if (folder) showToast({ message: t('sharedNotice', { name: personName(first.f), folder: folder.name }) });
      }
      await repo.write(() => repo.setKv(key, [...next]));
    })();
    return () => {
      alive = false;
    };
    // 폴더 이름은 그때의 것(폴더 목록이 바뀔 때마다 다시 알리지 않게)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loaded, accountId]);

  // 권한이 바뀌어(함께 편집 → 보기만, 공유 해제) 서버가 막은 글: 알리고 내 기본 폴더에 보관할 수 있게
  useEffect(() => {
    const check = async () => {
      const lost = await repo.getKv<{ entity: 'todo' | 'paragraph'; text: string }[]>('rejected_texts', []);
      if (!lost.length) return;
      await repo.write(() => repo.setKv('rejected_texts', []));
      showToast({
        message: t('rejectedWrites', { n: lost.length }),
        action: {
          label: t('keepInBase'),
          run: () => {
            void repo.copyItems({
              todos: lost.filter((x) => x.entity === 'todo').map((x) => ({ text: x.text })),
              paragraphs: lost.filter((x) => x.entity === 'paragraph').map((x) => x.text),
              target: null,
              keepDates: false,
            });
          },
        },
      });
    };
    const off = repo.subscribe((_s, tables) => {
      if (tables.has('kv')) void check();
    });
    const offDesk = desktop?.onDataChanged((tables) => {
      if (!tables || tables.includes('friends')) void check();
    });
    void check();
    return () => {
      off();
      offDesk?.();
    };
  }, [repo, showToast, t]);

  const api = useMemo<FriendsApi>(
    () => ({
      data,
      loaded,
      refresh,
      search: (email) => sync.shareApi<FriendSearch>(`/api/friends/search?email=${encodeURIComponent(email.trim())}`),
      request: async (email, userId) => {
        const r = await sync.shareApi<RequestResult>('/api/friends/requests', { method: 'POST', body: JSON.stringify({ email: email.trim(), user_id: userId }) });
        await refresh();
        return r;
      },
      accept: async (id) => {
        const r = await sync.shareApi<{ friend: Person }>(`/api/friends/requests/${id}/accept`, { method: 'POST' });
        await refresh();
        return r.friend;
      },
      decline: async (id) => {
        await sync.shareApi(`/api/friends/requests/${id}/decline`, { method: 'POST' });
        await refresh();
      },
      cancel: async (id) => {
        await sync.shareApi(`/api/friends/requests/${id}`, { method: 'DELETE' });
        await refresh();
      },
      remove: async (userId) => {
        await sync.shareApi(`/api/friends/${userId}`, { method: 'DELETE' });
        await refresh();
      },
      shareFolder: async (folderId, userIds, role) => {
        // 폴더가 서버에 올라가 있어야 공유할 수 있다
        await sync.syncNow();
        try {
          for (const folder of Array.isArray(folderId) ? folderId : [folderId]) {
            for (const id of userIds) {
              await sync
                .shareApi(`/api/folders/${folder}/members`, { method: 'POST', body: JSON.stringify({ user_id: id, role }) })
                .catch((e: unknown) => {
                  if ((e as { code?: string })?.code !== 'already_shared') throw e;
                });
            }
          }
        } finally {
          // 중간에 실패해도 그때까지 공유한 것은 목록에 보이게
          await refresh();
        }
      },
      createShared: async (name, userIds, role) => {
        const id = await repo.createFolder(name);
        await sync.syncNow();
        for (const u of userIds) {
          await sync.shareApi(`/api/folders/${id}/members`, { method: 'POST', body: JSON.stringify({ user_id: u, role }) });
        }
        await refresh();
        return id;
      },
      setHome: async (folderId, home) => {
        await sync.shareApi(`/api/folders/${folderId}/home`, { method: 'PUT', body: JSON.stringify({ home }) });
        await repo.setSharedHome(folderId, home);
        void refresh();
      },
      leave: async (folderId) => {
        await sync.shareApi(`/api/folders/${folderId}/leave`, { method: 'POST' });
        await refresh();
      },
    }),
    [data, loaded, refresh, sync, repo],
  );
  return <FriendsCtx.Provider value={api}>{children}</FriendsCtx.Provider>;
}

const NONE: FriendsApi = {
  data: EMPTY,
  loaded: false,
  refresh: async () => {},
  search: async () => ({ user: { id: '', email: '', name: '' }, status: 'none' }),
  request: async () => ({ status: 'requested', request: { id: '' } }),
  accept: async () => ({ id: '', email: '', name: '' }),
  decline: async () => {},
  cancel: async () => {},
  remove: async () => {},
  shareFolder: async () => {},
  createShared: async () => '',
  setHome: async () => {},
  leave: async () => {},
};

export function useFriends() {
  return useContext(FriendsCtx) ?? NONE;
}
