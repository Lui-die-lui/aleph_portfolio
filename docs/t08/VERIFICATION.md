# Task 08 — 검증 기록

아래 네 가지는 실제로 로컬 서버(`node --env-file=.env server.js`, 실제 Supabase DB 연결)에
직접 요청을 보내서 얻은 결과다. 추측이나 예상 값이 아니다. 재현용 스크립트는
`test/t08/http.test.js`의 동일 시나리오 테스트로도 남아 있다(2026-09-23 실행, 30/30 통과).

## 1. 로그인 없이 열기

**요청**
```
GET /api/t08/private-items
(쿠키 없음)
```

**성공 시(참고, 로그인 상태)**
```
Status: 200
{
  "items": [
    {
      "id": "cce3a1c1-85cd-4154-a756-22b8fc678c09",
      "title": "A note",
      "content": "a",
      "category": "note",
      "created_at": "2026-09-23T00:47:03.119Z",
      "updated_at": "2026-09-23T00:47:03.119Z"
    }
  ]
}
```

**거절(실제 응답, 쿠키 없이 요청)**
```
Status: 401
{ "error": "not_authenticated" }
```

## 2. 다른 계정 자료 열기

계정 A(자료 1건 소유)의 항목 id로, 계정 B의 세션 쿠키를 이용해 PATCH 시도.

**요청**
```
PATCH /api/t08/private-items/{A의 item id}
Cookie: {B의 세션}
Body: { "title": "x", "content": "x", "category": "x" }
```

**성공 시(참고, A 본인 세션으로 동일 자료 조회)**
```
Status: 200
{ "items": [ { "id": "...", "title": "A note", ... } ] }
```

**거절(실제 응답)**
```
Status: 404
{ "error": "not_found" }
```

다른 계정 소유라서 거절된 것인지, 존재하지 않아서인지 클라이언트가 구분할 수 없도록 동일하게
404를 반환한다(`api/t08/_lib/privateItems.js#updateOwned`). GET/DELETE, 그리고 패스키 삭제도
동일한 패턴(`_lib/passkeys.js#deleteOwned`)이며, 양방향(A→B, B→A) 모두
`test/t08/http.test.js`의 교차 계정 테스트로 자동 확인됨.

## 3. 이미 사용한 challenge 재사용

가짜(서명은 조작되었지만 challenge/origin은 진짜인) 등록 응답을 같은 challenge로 두 번 전송.

**요청 (1번째)**
```
POST /api/t08/passkeys/register/verify
Body: { "response": { ...challenge: "<실제 발급된 challenge>"... }, "deviceName": "x" }
```

**실제 응답 (1번째 — 서명 자체가 가짜라 등록은 애초에 실패)**
```
Status: 400
{ "error": "registration_failed" }
```

**요청 (2번째, 동일 challenge 재전송)**

**실제 응답 (2번째)**
```
Status: 400
{ "error": "registration_failed" }
```

이 케이스는 서명이 가짜라서 1번째부터 이미 실패하므로 "challenge가 재사용돼서 막혔다"는 것을
이 응답만으로는 구분할 수 없다. challenge 재사용이 원인임을 명확히 보여주는 것은
`test/t08/challenge.test.js`의 라이브러리 단위 테스트다(실제 응답):

```
recordChallenge(challenge, 'registration') 후
consumeChallenge(challenge, 'registration') → 1번째: 레코드 반환(성공)
consumeChallenge(challenge, 'registration') → 2번째: null(거절)
```

그리고 `test/t08/registration-reject.test.js`의 "replaying the same challenge a second time
never succeeds"가 HTTP 레벨에서 동일한 결론(두 번째 요청도 400, passkey 저장 개수 0 유지)을
실제로 확인한다.

## 4. 패스키 삭제 뒤 로그인

[수동 확인 필요] — 실제 인증장치(플랫폼 생체 인증 또는 보안키)로 패스키를 등록·삭제·재로그인하는
과정이 필요해 자동화할 수 없다. 절차는 `docs/t08/MANUAL_TEST.md`의 "패스키 두 개 확인" 섹션을
따를 것. 서버 측 로직(삭제된 credential로는 `findByCredentialId`가 null을 반환해 401)은
`api/t08/_lib/handlers/authVerify.js` 코드 검토와, 등록되지 않은 credential id로의 로그인
시도가 401로 거절되는 것을 확인한 자동 테스트(`test/t08/http.test.js`, "logging in with a
credential id that was never registered is rejected")로 간접 검증했다.
