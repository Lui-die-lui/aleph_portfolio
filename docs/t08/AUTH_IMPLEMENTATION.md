# Task 08 — 인증 구현 설명

## 1. 무엇으로 붙였나

- **WebAuthn / Passkey**: `@simplewebauthn/server` 14.0.2 (서버) + `@simplewebauthn/browser` 14.0.0 (클라이언트, `js/vendor/simplewebauthn-browser.js`로 번들). 비밀번호·이메일·SNS 로그인은 전혀 사용하지 않는다.
- **세션**: 서버 발급 랜덤 토큰(`crypto.randomBytes(32)`) + HttpOnly 쿠키. DB에는 토큰 원문이 아니라 HMAC-SHA256 해시만 저장(`api/t08/_lib/session.js`, `api/t08/_lib/crypto.js`).
- **DB**: Supabase(Postgres), `t08_` 접두사 테이블 5개 + 초대 토큰용 `t08_invite_tokens` 1개(§7 참고). 접속은 `pg` 패키지로 커넥션 스트링 직접 사용(`api/t08/_lib/db.js`).
- **API 배포 형태**: Vercel Serverless Function. Hobby 플랜 12개 제한 때문에 대부분의 라우트를 `api/t08/dispatch.js` 하나의 catch-all 함수로 합치고, `vercel.json`의 rewrite(`/api/t08/(.*) → /api/t08/dispatch`)로 라우팅한다.

## 2. 왜 그것을 선택했나

- **WebAuthn**: 과제 요구사항(비밀번호 미사용, 개인키를 서버로 절대 보내지 않음)을 표준 스펙으로 만족하는 사실상 유일한 방법. 개인키는 항상 클라이언트 인증장치(플랫폼 authenticator/보안키)에만 남고, 서버는 공개키만 본다.
- **HMAC 해시 세션/challenge/초대 토큰**: DB가 유출되어도 해시만으로는 토큰을 재사용할 수 없게 하기 위함(`api/t08/_lib/crypto.js`의 주석 참고). 평문 SHA-256이 아니라 HMAC을 쓴 이유는 `T08_SESSION_SECRET`이라는 별도 페퍼가 있어야 해시를 재현할 수 있게 하기 위함.
- **catch-all 함수 하나로 통합**: 애초에 라우트마다 별도 `api/t08/xxx.js` 파일로 구현했으나 Vercel Hobby 12-함수 제한에 걸려(실측 500 에러 발생, `8695738` 커밋 이력 참고) `fe5fffa`, `f3b9e65`, `9c02c62` 커밋에서 단계적으로 통합했다. bootstrap/invite 두 그룹만 별도 파일로 남긴 이유는 사용 빈도가 극히 낮고(최초 1회, 계정 생성 시 1회) 플래그로 잠겨 있어 굳이 catch-all에 섞을 이유가 없었기 때문(`api/t08/dispatch.js` 상단 주석 참고).
- **Vercel의 `[...path].js` 대신 명시적 rewrite**: `api/t08/dispatch.js` 21-26행 주석에 기록된 대로, non-Next.js 프로젝트에서는 bracket catch-all이 2단계 이상 깊이의 경로(`/api/t08/auth/options` 등)를 못 잡는 현상을 실측으로 확인하고 rewrite 방식으로 바꿨다(`9c02c62` 커밋).

## 3. 어디를 어떻게 고쳤나 — 실제 경로

| 흐름 | 클라이언트 | 서버 진입점 | 핵심 함수 |
|---|---|---|---|
| 등록(최초 owner) | `t08-bootstrap.html` | `api/t08/bootstrap/register/options.js`, `.../verify.js` | `generateRegistrationOptions`, `verifyRegistrationResponse`, `passkeys.js#insert` |
| 등록(초대 계정) | `t08-invite.html` | `api/t08/invite/register/options.js`, `.../verify.js` | `invites.js#peekInvite`/`consumeInvite`, `verifyRegistrationResponse` |
| 등록(로그인 후 추가 패스키) | `js/t08-auth.js#addPasskey` | `dispatch.js` → `_lib/handlers/passkeysRegisterOptions.js`, `passkeysRegisterVerify.js` | `session.js#requireSession`, `verifyRegistrationResponse` |
| 로그인 | `js/t08-auth.js#login` | `dispatch.js` → `_lib/handlers/authOptions.js`, `authVerify.js` | `verifyAuthenticationResponse`, `passkeys.js#findByCredentialId`/`touchAfterLogin`, `session.js#createSession` |
| 세션 확인 | `js/t08-auth.js#checkSession` | `dispatch.js` → `_lib/handlers/authSession.js` | `session.js#requireSession` |
| 로그아웃 | `js/t08-auth.js#logout` | `dispatch.js` → `_lib/handlers/authLogout.js` | `session.js#revokeSession` |
| 비공개 자료 조회/추가/수정/삭제 | `js/t08-auth.js#loadPrivateItems/saveItem/confirmDeleteItem` | `dispatch.js` → `_lib/handlers/privateItems{List,Create,Update,Delete}.js` | `privateItems.js#listByUser/insert/updateOwned/deleteOwned` |
| 패스키 목록/삭제 | `js/t08-auth.js#loadPasskeys/deletePasskey` | `dispatch.js` → `_lib/handlers/passkeys{List,Delete}.js` | `passkeys.js#listByUser/deleteOwned` |

이번 작업(검증/문서 단계)에서 실제로 고친 부분은 다음뿐이며, 위 인증 흐름 자체는 바꾸지 않았다.

- `js/t08-auth.js`: 성공 상태 메시지가 화면에 계속 남던 문제를 고침(`setStatus`에 2.6초 자동 소거 타이머 추가), 패스키 삭제 전 `window.confirm` 확인창 추가, 마지막 패스키 삭제 거부 안내 문구를 과제 문구에 맞게 수정, 비공개 자료 카드에 `updated_at` 표시 추가.
- `css/style.css`: `.t08-status-success`, `.t08-item-updated` 두 규칙 추가(기존 색상 팔레트 안에서).
- `test/t08/http.test.js`: 미등록 credential 로그인 거부 테스트, 양방향(A→B, B→A) 자료/패스키 격리 테스트 3건 추가.
- `image/key.png` 아이콘 크기 조정(디자인 잔수정, 인증 로직과 무관).

## 4. 안 열리는 것을 확인한 기록

아래는 실제 코드를 읽고, 필요한 부분은 자동 테스트로 실행해서 확인한 결과다. 파일/함수를 근거로 남긴다.

| 조건 | 근거 파일/함수 | 확인 방법 |
|---|---|---|
| 비로그인 비공개 API 401 | `_lib/handlers/privateItemsList.js` 등 전 핸들러의 `requireSession` 체크 | `test/t08/http.test.js` (401 테스트 4건) 자동 통과 |
| 소유권은 항상 `session.userId` | `_lib/privateItems.js#listByUser/updateOwned/deleteOwned`, `_lib/passkeys.js#deleteOwned` — 쿼리에 `user_id = $세션값`만 사용, 클라이언트 `userId`는 애초에 읽지 않음 | 코드 리딩 + `http.test.js`의 "다른 userId를 보내도 세션 사용자 자료만 반환" 테스트 |
| 자료 수정/삭제는 `item.id` AND `session.userId` 동시 검사 | `_lib/privateItems.js#updateOwned/deleteOwned`의 `where id = $1 and user_id = $2` | `http.test.js` 교차 계정 테스트(양방향) |
| 패스키 삭제는 `credential.id` AND `session.userId` 동시 검사 | `_lib/passkeys.js#deleteOwned`의 트랜잭션 내 `where id = $1 and user_id = $2` | `http.test.js` 교차 계정 패스키 삭제 테스트(양방향) |
| challenge는 요청마다 새로 생성, 만료 있음, 1회용 | `_lib/challenge.js#recordChallenge`(매 옵션 요청마다 호출), `CHALLENGE_TTL_MS = 2분`, `consumeChallenge`의 원자적 `UPDATE ... WHERE used_at IS NULL AND expires_at > now()` | `test/t08/challenge.test.js` 3건 + `registration-reject.test.js`의 replay 테스트 + 이번에 추가한 미등록 credential 재시도 테스트 |
| 로그인 검증 성공 후에만 세션 생성 | `_lib/handlers/authVerify.js` — `verification.verified` 확인 후에만 `createSession` 호출 | 코드 리딩(성공 경로 앞에 조기 return이 모두 있음) |
| 로그아웃 시 세션 폐기, 이후 접근 불가 | `_lib/session.js#revokeSession`(`revoked_at = now()`), `requireSession`의 `revoked_at is null` 조건 | `http.test.js`, `session.test.js` |
| 개인키/세션 토큰 원문 미저장 | `_lib/session.js#createSession`(`hmacHex(rawToken)`만 저장), `_lib/passkeys.js#insert`(공개키만 저장, `verification.registrationInfo.credential.publicKey`) | 코드 리딩 — DB insert 문에 원문 토큰/개인키 컬럼 자체가 없음 |
| 마지막 패스키 삭제 서버 거부 | `_lib/passkeys.js#deleteOwned` — 트랜잭션으로 개수 확인 후 1개 이하면 `'last_remaining'` 반환, 실제 DELETE는 실행 안 함 | `http.test.js`의 409 테스트 |
| 실제 개인정보 미사용 | `scripts/t08-seed-private-items.js`의 샘플 데이터가 전부 "가상의 ~ (과제용 더미 데이터)"로 명시됨 | 코드 리딩 + DB 라이브 조회로 실제 저장된 값 확인 |

## 5. AI와 나

WebAuthn 스펙 용어(challenge, credential, attestation 등)와 `@simplewebauthn` 라이브러리 사용법은
처음이라 초기 구현 자체는 AI에게 맡겼다. 대신 절대 타협하지 않을 조건(비밀번호 미사용, 개인키를
서버로 보내지 않음, 자료 소유권은 항상 서버 세션의 `userId`로만 판단)은 내가 과제 요구사항에
명시해서, AI가 그 틀 밖으로 나가지 못하게 했다.

실제로 배포된 화면을 직접 열어보면서 문제를 찾은 것은 내 몫이었다 — 성공 메시지("로그아웃했습니다."
등)가 계속 화면에 남아 있는 것, PRIVATE ARCHIVE가 다른 폴더들과 다르게 페이지 하단에 뚝 떨어진
별도 섹션으로 붙어 있던 것, 열쇠 아이콘이 다른 폴더 아이콘보다 큰 것 — 이런 건 캡처를 찍어가며
직접 지적했고, AI는 그 지적에 맞춰 코드를 고치는 역할이었다.

이번 검증 라운드에서는 "이미 정상 동작하는 인증 구조를 다시 만들거나 대규모로 리팩터링하지 말 것"이라고
먼저 선을 그은 뒤에, 보안 조건 재확인·테스트 보완·문서화만 맡겼다. 보안 점검 결과 이미 지켜지고 있던
부분은 AI가 임의로 손대지 않고 근거(파일/함수)만 문서에 남기도록 했다.

## 6. 아직 못 막은 것

- **패스키 동기화 계정 자체가 탈취된 경우**: iCloud Keychain/Google 비밀번호 관리자처럼 여러 기기에 패스키를 동기화하는 환경에서는, 그 동기화 계정(Apple ID/Google 계정)이 탈취되면 등록된 패스키도 함께 넘어갈 수 있다. 이 위협은 WebAuthn 표준 자체의 한계이며, 이 구현이 별도로 막고 있지 않다.
- **모든 패스키를 분실했을 때의 자동 복구 절차 없음**: `_lib/passkeys.js#deleteOwned`가 "마지막 패스키는 못 지운다"는 막아주지만, 반대로 등록된 기기를 전부 잃어버리면(도난·초기화 등) 계정에 다시 들어올 방법이 없다. 현재는 운영자가 DB를 직접 조작하거나 새 초대 토큰으로 새 계정을 만드는 수밖에 없다.
- **대규모 요청에 대한 rate limit 없음**: `auth/options`, `auth/verify` 등 모든 핸들러가 요청 횟수 제한 없이 그대로 DB에 쿼리를 날린다. 짧은 시간에 매우 많은 요청을 보내는 것을 막는 별도 장치(IP/계정 단위 rate limit)가 없어, 실제 서비스라면 추가가 필요하다.
