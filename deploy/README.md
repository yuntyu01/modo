# modo 비공개 테스트 서버

이 구성은 modo 전용이다. 기존 앱의 네임스페이스·DB·PVC를 재사용하거나 삭제하지 않는다. 운영 서버 적용 여부는 배포 화면과 HTTPS API 응답으로 확인한다.

## KoDeploy

- 저장소: `yuntyu01/modo`, 작업 브랜치: `codex/modo-closed-test`
- 런타임 Go, 저장소 루트의 `Dockerfile`, 포트 8080
- 새 PostgreSQL 의존성, 새 영속 저장소를 `/var/lib/modo`에 연결
- 환경: `APP_ENV=production`, `PUBLIC_URL=https://modo.kodeploy.com`, `LOG_DIR=/var/lib/modo/logs`, `ERASURE_JOURNAL=/var/lib/modo/erasures/journal.json`, `BACKUP_DIR=/var/lib/modo/backups`, `MODO_BACKUPS_ENABLED=1`, `TRUST_PROXY=1`(HTTPS 프록시 뒤라 이것이 없으면 로그인 요청 수 제한을 모든 사용자가 함께 쓴다. `Dockerfile`에 기본값으로 들어 있다)
- 플랫폼이 주입한 PostgreSQL `DATABASE_URL`을 사용한다. SQLAlchemy 접두사는 서버와 운영 도구에서 정규화한다. 실제 확인된 내부 `postgres` 서비스는 TLS가 꺼져 있어 이 전용 주입 주소에만 `sslmode=disable`을 적용한다. 외부 DB나 명시한 TLS 옵션은 바꾸지 않는다. 앱에서 공개 서버까지는 HTTPS를 사용한다. 비밀번호를 문서나 빌드 로그에 넣지 않는다.
- 단일 replica와 Recreate 전략을 유지한다. 삭제 저널은 서버만 기록하고 외부 운영 도구는 별도 영속 요청함을 사용한다. 서버는 요청함을 인증 시 즉시 확인해 접근을 차단하고 매시간 저널로 수합한다.
- 카카오 키는 아직 설정하지 않았다. 이메일 로그인과 로컬 사용을 우선 검증한다. 카카오를 제공하려면 실제 앱 및 Redirect URI 승인이 별도로 필요하다.
- 정적 슬롯이 없다면 modo 도메인에서 서버를 제공하는지 실제 라우팅을 확인한다. 다른 앱의 도메인을 바꾸지 않는다.

`/healthz`는 DB 연결, 백업 상태와 7일 초과 미처리 삭제를 검사한다. `/api/auth/providers`가 JSON을 반환해야 한다. 두 API가 404인 상태를 배포 완료로 처리하지 않는다.

## 기존 Store 심사 계정

일반 사용자는 Google·카카오로 로그인하며 `PASSWORD_LOGIN`은 켜지 않는다. 서버의 `STORE_REVIEW_EMAIL`에 기존 심사 전용 계정 하나만 지정할 수 있다. 비어 있거나 이메일 형식이 잘못되면 심사 로그인이 비활성이다. 계정이나 비밀번호를 새로 만들지 않고 기존 bcrypt 인증 정보로 `/api/auth/review`에서 검증한다. 다른 계정은 올바른 비밀번호를 보내도 거부하며, 일반 가입·로그인은 여전히 410을 반환한다. 기존 요청 횟수 제한, 삭제 계정 차단, 해시 세션 저장·만료와 계정 삭제 정책을 그대로 적용한다. 인증 정보는 코드·문서·로그에 넣지 않는다.

Android 로그인 화면은 서버가 `storeReview=true`를 알릴 때만 `Store review account` 입력창을 제공한다. Google Play 로그인 세부정보에는 이 경로와 기존 전용 계정만 안내한다. 테스트용 계정에 실제 개인정보를 넣거나 실제 참여·설치 실적으로 집계하지 않는다. 이 설정은 Windows 배포를 다시 제출하지 않는다.

## 보관·삭제 구현

- `DELETE /api/me`: 현재 세션으로만 자신의 계정을 삭제한다. 요청 본문은 `{"confirmation":"DELETE"}`이다. 응답 204는 운영 DB 삭제 완료, 202는 영속 저널에 접수되어 접근은 차단됐고 재시도 중임을 뜻한다.
- 삭제 의사를 먼저 별도 영속 저널에 fsync하고 모든 세션을 차단한다. 사용자 행 삭제의 FK CASCADE가 소유 폴더·메모·할 일·완료 기록·로그인·세션·공유 링크·멤버십·재전송 기록·활동 기록에 반영된다. 다른 사용자가 소유한 폴더는 삭제하지 않는다.
- 실패 작업은 매시간 재시도하고 7일을 넘기면 `/healthz`를 실패시킨다. 미완료 삭제 저널은 만료시키지 않는다.
- 삭제 완료 후 UUID와 처리 시각만 복원 방지를 위해 최대 30일 보관한다. 콘텐츠·이메일·비밀번호·토큰은 저널에 없다.
- 애플리케이션 로그는 일별 파일로 회전하고 30일이 되기 전에 삭제한다. 요청 본문·이메일·IP·비밀번호·토큰을 로그에 기록하지 않는다. 오류는 고정된 이벤트 코드만 기록한다.
- 백업은 하루 한 번 생성하고 15분마다 만료를 확인한다. 29일 된 백업을 지워 최대 30일 안에 만료되도록 여유를 둔다. 실패 시 마지막 성공 백업을 보존하고 상태 점검을 실패시킨다.
- 백업은 DB만 포함한다. 삭제 저널은 DB 백업과 분리된 앱 영속 저장소에 둔다. JSON 내보내기 파일·다른 기기의 오프라인 복사본은 사용자가 별도 관리한다.
- 호스팅 프록시·Cloudflare·DB 자체 로그와 외부 백업은 계정 설정에서 추가 검증해야 한다. 소스의 설정만으로 실제 적용을 주장하지 않는다.

## 활동 기록(1단계, 서버만)

일간·주간 사용자 수, 다시 온 비율, PC·휴대폰 비율, 바로 받기가 없는 옛 PC 판을 아직 쓰는 사람을 보려고 서버가 하루 사용량만 센다(`server/internal/api/activity.go`). 앱은 바꾸지 않았다.

- 표 `daily_activity`: 한 줄 = 계정 UUID·날짜(서울)·플랫폼·앱 판. 열은 `requests`(로그인한 API 요청 전부), `syncs`(동기화 `/api/sync/push`·`/api/sync/pull`, 바뀐 것이 있으면 한 번 동기화에 2), `waits`(바로 받기 `/api/sync/wait`, 최대 25초 기다리는 요청), `first_at`·`last_at`(그날 처음·마지막 요청 시각).
- 플랫폼: 앱이 로그인할 때 보낸 세션 기기 이름(`Android`·`iPhone`·`Windows`·`Desktop`)을 `android`·`ios`·`windows`·`desktop`으로, 그 밖은 `other`.
- 앱 판: PC는 Electron User-Agent의 `<앱 이름>/<판>`(예: `modo-desktop/1.0.43`), iPhone은 CFNetwork User-Agent의 빌드 번호(마케팅 판이 아님). Android(OkHttp)는 판을 보내지 않아 비어 있다(`''`). 판을 몰라도 `waits`가 있으면 바로 받기가 있는 판이다.
- 2단계(앱 변경): 앱이 `X-Modo-Client: android/1.0.44`처럼 `<플랫폼>/<판>`을 붙이면 서버가 그 판을 먼저 쓴다. 서버는 이미 받으며 CORS도 허용해 두었다.
- 남기지 않는 것: 할 일·메모·폴더 이름 같은 내용, 이메일, IP, User-Agent 원문(판 번호만 뽑는다), 기기 모델, 요청 경로·시각별 기록.
- 요청마다 DB에 쓰지 않는다. 서버 메모리에 모아 5분마다 한 문장으로 더하고, 정상 종료(재배포) 때 마저 쓴다. 갑자기 죽으면 최대 5분 치를 잃는다. 단일 replica 전제다.
- 보관: 400일(약 13개월)이 지난 날은 매시간 정리에서 지운다. 계정을 지우면 FK CASCADE로 함께 지워지고 아직 메모리에 있던 숫자도 버린다. DB 백업에 든 것은 백업 만료(최대 30일)와 함께 사라진다.

### 집계 보기

`ADMIN_TOKEN`(32자 이상 난수)을 넣으면 `GET /api/admin/activity?days=N`이 켜진다. 없거나 32자 미만이면 404다. 응답은 숫자만이고 계정 id·이메일은 없다. 토큰은 문서·로그·채팅에 넣지 않는다.

```sh
openssl rand -hex 32   # 한 번 만들어 KoDeploy 환경 변수 ADMIN_TOKEN에 넣는다
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" 'https://modo.kodeploy.com/api/admin/activity?days=14'
```

```json
{
  "daily": [
    "… 앞의 12일 …",
    {"day": "2026-10-25", "users": 3, "platforms": {"android": 3, "windows": 2}, "requests": 1840, "syncs": 512, "waits": 1203},
    {"day": "2026-10-26", "users": 2, "platforms": {"android": 2, "windows": 1}, "requests": 640, "syncs": 180, "waits": 410}
  ],
  "days": 14,
  "latest": {"day": "2026-10-26", "dau": 2, "mau": 3, "wau": 3},
  "return": {"d1": {"base": 30, "returned": 21, "rate": 0.7}, "d7": {"base": 12, "returned": 6, "rate": 0.5}},
  "today": "2026-10-26",
  "versions": [
    {"platform": "android", "version": "", "users": 3},
    {"platform": "windows", "version": "1.0.43", "users": 1},
    {"platform": "windows", "version": "1.0.30", "users": 1}
  ]
}
```

- `daily`: 날마다 사용자 수(DAU)와 플랫폼별 사용자 수(PC·휴대폰을 다 쓰면 양쪽에 센다), 요청·동기화·바로 받기 합. 오늘(서울)까지, 빈 날도 0으로 나온다. 보기 전에 메모리의 숫자를 먼저 쓴다.
- `latest`: 오늘 DAU, WAU(최근 7일), MAU(최근 30일).
- `versions`: 최근 7일에 쓴 사람마다 플랫폼별 마지막 판의 분포. `""`는 판을 모름.
- `return.d1`·`return.d7`: 기간 안 어제까지, 어느 날 쓴 사람이 다음 날·7일 뒤 그날에도 쓴 비율. `base`는 비교한 (사람, 날) 수, `rate`는 `base`가 0이면 `null`.
- `days`는 1~400(기본 30). 접속 주소마다 1분에 10번까지.

DB를 직접 볼 때:

```sql
-- 날마다 DAU와 PC·휴대폰 사용자 수
SELECT day, count(DISTINCT user_id) AS dau,
  count(DISTINCT user_id) FILTER (WHERE platform IN ('windows', 'desktop')) AS pc,
  count(DISTINCT user_id) FILTER (WHERE platform IN ('android', 'ios')) AS phone
FROM daily_activity WHERE day > current_date - 30 GROUP BY day ORDER BY day;

-- WAU · MAU
SELECT count(DISTINCT user_id) FILTER (WHERE day > current_date - 7) AS wau, count(DISTINCT user_id) AS mau
FROM daily_activity WHERE day > current_date - 30;

-- 최근 7일 PC 판 분포(사람마다 마지막 판)
SELECT app_version, count(*) FROM (
  SELECT DISTINCT ON (user_id) app_version FROM daily_activity
  WHERE platform IN ('windows', 'desktop') AND day > current_date - 7 ORDER BY user_id, last_at DESC
) v GROUP BY app_version ORDER BY 2 DESC;

-- 최근 7일 동기화는 했는데 바로 받기가 없던 줄(대략 옛 판): 플랫폼별 사람 수
SELECT platform, count(DISTINCT user_id) FROM daily_activity
WHERE day > current_date - 7 AND syncs > 0 AND waits = 0 GROUP BY platform;
```

### 주인이 할 일

1. KoDeploy에서 이 커밋을 배포한다(push만으로는 배포되지 않는다). 표는 서버가 켜질 때 만들어진다.
2. KoDeploy 환경 변수 `ADMIN_TOKEN`에 `openssl rand -hex 32` 값을 넣는다(Compose 대안은 `.env`의 `ADMIN_TOKEN`).
3. 개인정보처리방침에 추가: 수집 항목 "서비스 이용 기록(이용 날짜, 기기 종류(Android·iPhone·Windows), 앱 버전, 날짜별 요청·동기화 횟수, 그날 처음·마지막 이용 시각)", 목적 "이용 통계와 서비스 품질 개선(동기화 지연 등 문제 파악)", 보관 "400일(약 13개월) 뒤 삭제, 회원 탈퇴 시 즉시 삭제(백업은 30일 안에 만료)", 제3자 제공·광고 사용 없음. 할 일 내용과 IP는 이 기록에 넣지 않는다고 적는다.
4. Play Console → 앱 콘텐츠 → 데이터 보안: **앱 활동 → 앱 상호작용**을 추가한다. 수집함, 공유하지 않음, 일시적 처리 아님, 필수(사용자가 끌 수 없음), 목적은 **분석**. 앱 버전·기기 종류는 이 기록에 딸린 값이다. 더 보수적으로 하려면 **앱 정보 및 성능 → 기타 앱 성능 데이터**도 같은 설정으로 고른다. 전송 중 암호화(HTTPS)와 삭제 요청 가능은 기존 답을 그대로 둔다.
5. iPhone을 App Store에 낼 때는 앱 개인정보 보호에 사용 데이터 → 제품 상호작용(사용자에 연결됨, 추적에 쓰지 않음, 목적 분석)을 넣는다.

## 외부 삭제 요청 처리

지원 이메일 `yuntyu01@gmail.com`으로 접수한다. 외부 요청은 계정 소유 확인 전 실행하지 않는다. 이메일 헤더의 발신 주소만 믿지 말고 등록 이메일로 보낸 별도 확인 요청에 대한 회신 또는 인증된 계정 소유 증거를 확인한다. 카카오 계정은 카카오 소유도 확인한다. 비밀번호·세션 토큰·신분증 제출을 요구하지 않는다.

확인된 계정 UUID를 담당자가 modo 서버에서 다음 명령에 전달한다. 이 명령은 운영자 전용이며 공개 API가 아니다. 요청자에게 계정 존재 여부나 다른 사용자 정보를 공개하지 않는다.

```sh
MODO_ACCOUNT_VERIFIED='<verified-account-uuid>' modo-ops delete-account '<verified-account-uuid>'
```

완료·실패를 기록하고 본인 확인 완료일부터 운영 DB를 가능한 즉시, 최대 7일 안에 삭제한다. 실패하면 저널에 남아 세션 차단과 자동 재시도가 유지된다. 사용자에게 삭제 완료와 백업 만료 시점을 구분해 알린다.

## 복원

삭제 저널을 백업 DB로 덮어쓰지 않는다. 기존 저널이 없거나 손상되면 복원을 중단한다. 복원은 아래 도구만 사용하며 30일보다 오래된 백업을 사용하지 않는다.

```sh
MODO_RESTORE_CONFIRM=restore-modo-only modo-ops restore /var/lib/modo/backups/modo-<timestamp>.dump
```

도구는 유지보수 표식을 만들고 트랜잭션으로 복원한 다음, 별도 삭제 저널을 재적용한다. 재적용 성공 전에는 표식을 제거하지 않는다. 실패하면 서비스는 503을 유지한다. 원시 `pg_restore`만 실행하고 서비스를 다시 열지 않는다.

## Compose 대안

기존 호스트의 HTTPS 프록시에만 연결한다. `deploy/compose.production.yml`은 별도 `modo-closed-test` 프로젝트와 새 DB·저널·백업 볼륨을 사용한다. 새 비용이 발생하는 서버를 만들지 않는다. 비밀번호는 URL에 안전한 난수로 생성해 기존 secret 관리에 넣는다.

```sh
docker compose -f deploy/compose.production.yml up -d --build
```

공개 서버에서 실행하기 전 HTTPS 프록시 접근·오류 로그가 최대 30일이며 본문·인증 정보가 제외되는지 확인한다. 이 문서는 플랫폼 전체에 대한 설정 변경 권한을 부여하지 않는다.
