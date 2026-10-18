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
export type SharedFolder = { folder_id: string; role: 'view' | 'edit'; owner: Person };

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
