export type Folder = {
  id: string;
  name: string;
  position: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export type Todo = {
  id: string;
  folder_id: string | null;
  text: string;
  /** done_at에서 계산(저장하지 않음) */
  done: boolean;
  done_at: number | null;
  due_date: string | null;
  remind_at: number | null;
  /** 반복(없으면 null). 반복이면 due_date가 다음 예정일(core/repeat.ts) */
  repeat_freq: 'daily' | 'weekly' | 'monthly' | null;
  /** 매주 반복의 요일 비트(월=1 … 일=64). 매주가 아니면 null */
  repeat_days: number | null;
  /** 루틴을 한 날들 'YYYY-MM-DD,…'(core/doneLog.ts) */
  done_log?: string | null;
  position: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  conflict_of: string | null;
};

export type Paragraph = {
  id: string;
  folder_id: string | null;
  text: string;
  position: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  conflict_of: string | null;
};

export type EntityName = 'folder' | 'todo' | 'paragraph';

export type Person = { id: string; email: string; name: string };

/** 내가 공유받은 폴더(남의 폴더). 이 폴더와 그 안의 항목은 주인의 것이다. */
/** home: 내 홈(목록 탭)에도 보일지(참여자 각자의 설정, 예전 서버는 보내지 않아 늘 보인다) */
export type SharedFolder = { folder_id: string; role: 'view' | 'edit'; owner: Person; home?: boolean };

/**
 * 친구와 함께 쓰는 폴더(서버가 pull로 알려 준다). role = 내 권한, friend_role = 친구의 권한(owner | edit | view).
 * 셋째 사람의 폴더에 둘 다 참여 중이면 둘 다 참여자 권한. home = 내 홈에 보이는지
 */
export type FriendFolder = { folder_id: string; role: 'owner' | 'edit' | 'view'; friend_role: 'owner' | 'edit' | 'view'; mine: boolean; home: boolean };
export type Friend = Person & { since: string; folders: FriendFolder[] };
export type FriendRequest = { id: string; user: Person; created_at: string };
/** 친구·대기 중인 받은/보낸 요청. 서버가 관리하고 동기화(pull)로 받아 kv 'friends'에 둔다 */
export type FriendsData = { friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] };

export type Snapshot = {
  folders: Folder[];
  todos: Todo[];
  paragraphs: Paragraph[];
  shared: SharedFolder[];
};

/**
 * 지금 보는 폴더. null = '기본' 폴더(폴더 ID가 없는 항목, 예전의 미분류).
 * 기본을 실제 폴더 행으로 만들지 않아 기기마다 기본 폴더가 따로 생겨 겹치는 일이 없다.
 */
export type FolderFilter = string | null;
