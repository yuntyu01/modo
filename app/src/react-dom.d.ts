// PC(웹) 말풍선(ui/textTip.web.tsx)이 쓰는 createPortal만. react-dom은 react-native-web이 함께 들고 오지만 타입 패키지가 없다
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactPortal;
}
