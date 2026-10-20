import { useState } from 'react';

/**
 * 항목 id마다 같은 함수 묶음을 돌려준다(카드는 memo라 함수가 바뀌면 다시 그려진다).
 * make는 useState의 setter처럼 늘 같은 것만 잡아야 한다. Map은 useState에 둔다(그리는 중에 ref를 읽으면 안 된다는 규칙).
 */
export function useIdHandlers<H>(make: (id: string) => H): (id: string) => H {
  const [map] = useState(() => new Map<string, H>());
  return (id) => {
    let h = map.get(id);
    if (!h) map.set(id, (h = make(id)));
    return h;
  };
}
