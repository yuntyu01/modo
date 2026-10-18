/**
 * 반복 할 일(루틴)의 '한 날' 기록: 'YYYY-MM-DD'를 쉼표로 이은 글(todos.done_log). 오래된 것부터 정렬, 최근 400일까지.
 * 서버는 기기마다 보낸 추가·삭제를 합친다(server sync.go kDateSet): 두 기기가 서로 다른 날을 체크해도 하나가 지워지지 않는다.
 * 위젯(Kotlin·Swift)도 같은 모양으로 쓴다.
 */
export const DONE_LOG_MAX = 400;

export function parseDoneLog(log: string | null | undefined): string[] {
  return log ? log.split(',').filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
}

function join(days: Iterable<string>): string | null {
  const list = [...new Set(days)].sort().slice(-DONE_LOG_MAX);
  return list.length ? list.join(',') : null;
}

export function addDoneDay(log: string | null | undefined, day: string): string | null {
  return join([...parseDoneLog(log), day]);
}

export function removeDoneDay(log: string | null | undefined, day: string): string | null {
  return join(parseDoneLog(log).filter((d) => d !== day));
}
