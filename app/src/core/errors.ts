/**
 * 사용자에게 보여 줄 수 있는 오류. code는 i18n의 err_<code> 문구로 바뀐다(모르는 code면 message 그대로).
 * 서버 오류 응답의 code(server/internal/api의 errJSON)도 같은 이름을 쓴다.
 */
export class CodedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
