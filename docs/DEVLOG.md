# twogether 개발 기록

둘이 같은 장소 목록을 실시간으로 함께 편집하는 지도 서비스. 네이버 지도 저장 기능은 공유 후 업데이트가 안 되는 불편이 있어서, 자체 DB를 두고 네이버 지도는 화면용으로만 쓴다.

## 링크

| 서비스 | 용도 | 주소 |
|---|---|---|
| 네이버클라우드 플랫폼 콘솔 | Application 등록, Dynamic Map Client ID, Web 서비스 URL 설정 | https://console.ncloud.com |
| 네이버 지도 API v3 문서 | 지도, 마커 사용법 | https://navermaps.github.io/maps.js.ncp/ |
| NAVER API HUB 문서 | 이전된 검색 API (현재 미사용) | https://api.ncloud-docs.com |
| 카카오 디벨로퍼스 | 앱 생성, [카카오맵] 사용 설정, REST API 키 | https://developers.kakao.com |
| 카카오 로컬 API 문서 | 키워드 장소 검색 | http://developers.kakao.com/docs/ko/local/dev-guide |
| Supabase 대시보드 | 프로젝트, SQL Editor, Authentication, API 키 | https://supabase.com/dashboard |
| Supabase 문서 | RLS, Realtime, Auth | https://supabase.com/docs |
| Vite | 빌드 도구, 프록시, 환경 변수 | https://vite.dev |
| Vercel | 배포, 환경 변수 | https://vercel.com |
| 배포 사이트 | 실제 서비스 주소 | https://twogether-three.vercel.app |

## 구조

| 역할 | 사용 기술 |
|---|---|
| 프론트엔드 | React + TypeScript (Vite) |
| 지도 표시 | 네이버 Dynamic Map |
| 장소 검색 | 카카오 로컬 API (키워드 검색) |
| DB / 인증 / 실시간 | Supabase (Postgres, Auth, Realtime, RLS) |
| 검색 API 키 보호 | Vercel 함수(api/search.ts), 개발 중에는 같은 주소를 Vite 프록시가 처리 |
| 배포 | GitHub(비공개) → Vercel 자동 배포 |
| 앱 설치 | PWA (홈 화면에 추가) |

```
브라우저 ──> 네이버 지도 (Client ID, 공개 가능)
   │
   ├──> /api/search ──(Vercel 함수, 서버에서 REST 키 추가)──> 카카오 로컬 API
   │
   └──> Supabase (공개 anon 키 + 로그인 토큰, RLS로 방 단위 접근 제한)
```

## 진행 순서

### 0. 프로젝트 생성
- `npm create vite@latest . -- --template react-ts`로 생성, `npm install`, 빌드 확인.
- Next.js도 고려했지만, 로그인 후 쓰는 지도 중심 앱이라 SSR이 필요 없어 Vite를 유지했다. 비밀 키가 필요한 호출만 서버 쪽으로 빼면 된다.

### 1. 지도 띄우기
- 네이버클라우드 플랫폼에서 Application을 등록하고 Dynamic Map Client ID 발급. Web 서비스 URL에 `http://localhost:5173` 등록.
- `.env.local`에 `VITE_NAVER_MAP_CLIENT_ID` 저장. `index.html`에서 `%VITE_NAVER_MAP_CLIENT_ID%`로 지도 스크립트 로드.
- `@types/navermaps`로 타입 추가.

### 2. 장소 검색
- **문제:** 네이버 개발자센터에 검색 API 신청 항목이 없었다. 검색 API가 NAVER API HUB(네이버클라우드)로 이전되었고 기존 개발자센터에서는 신규 신청이 안 된다고 한다.
- **결정:** 지도는 네이버를 유지하고 검색만 카카오 로컬 API로 교체. 한 번에 최대 15개(네이버 지역 검색은 5개 수준)이고 응답 좌표(x=경도, y=위도)를 네이버 지도에 바로 쓸 수 있다.
- 카카오 디벨로퍼스에서 앱 생성 후 [카카오맵] 사용 설정 ON, REST API 키 발급. JavaScript 키와 네이티브 앱 키는 쓰지 않는다.
- REST 키는 브라우저에 노출되면 안 되므로 변수 이름에 `VITE_`를 붙이지 않고(`KAKAO_REST_API_KEY`), [vite.config.ts](../vite.config.ts)의 프록시가 서버 쪽에서 `Authorization` 헤더를 붙여 호출한다.
- 검색창, 결과 목록, "추가" 시 마커 표시와 지도 이동.

### 3. Supabase 저장
- Supabase에서 Organization(Personal, Free)과 프로젝트(Seoul 리전) 생성.
- `.env.local`에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 저장. service_role 키는 사용하지 않는다.
- `places` 테이블 생성. 저장은 화면에 먼저 반영하고 실패하면 되돌리는 낙관적 업데이트.
- 이 단계는 로그인이 없어서 누구나 읽고 쓸 수 있는 임시 상태였다.

### 4. 로그인, 공유 방, 실시간
- 로그인은 이메일+비밀번호. 개발 중 가입이 막히지 않도록 Supabase의 이메일 확인(Confirm email)을 껐다.
- 테이블: `rooms`(초대 코드), `room_members`, `places`(room_id, added_by 추가). 전체 정의는 [supabase/schema.sql](../supabase/schema.sql).
- RLS: `is_member()` 함수(security definer)로 방 멤버만 읽고 쓰게 제한. `rooms`와 `room_members`에는 쓰기 정책을 두지 않고 `create_room()`, `join_room()` 함수로만 변경한다.
- 방 정원 4명: `join_room`에서 방 행을 `for update`로 잠근 뒤 인원을 센다. 동시에 입장해도 정원을 넘지 않는다.
- 사용자당 방 1개로 제한.
- Realtime: `places` 변경을 구독(`room_id` 필터). 내 저장이 성공해도 이벤트가 돌아오므로 `kakao_id` 기준으로 중복을 합친다. 저장 실패 시 롤백하되, 이미 같은 장소가 있어 생긴 unique 위반(23505)은 롤백하지 않는다.
- 시크릿 창으로 두 계정을 만들어 한쪽 추가가 다른 쪽에 새로고침 없이 뜨는 것을 확인.

### 5. 배포 준비와 Vercel 연결
- 카카오 검색 호출을 개발 서버 프록시에서 Vercel 함수([api/search.ts](../api/search.ts))로 옮겼다. query만 받아 키워드 검색 한 경로만 호출하고, 카카오 REST 키는 서버 환경 변수에서 읽는다. 개발 서버에서는 같은 주소(/api/search)를 Vite 프록시가 처리한다.
- GitHub 비공개 저장소(wjdals812/twogether)에 푸시. 저장소가 이미 공개 상태로 있어서 비공개로 전환한 뒤 올렸다.
- Vercel에서 저장소 Import. 비공개 저장소는 URL 입력으로는 접근이 안 되고 GitHub 앱 권한에서 저장소를 허용해야 했다.
- 환경 변수 4개(VITE_NAVER_MAP_CLIENT_ID, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, KAKAO_REST_API_KEY)를 Vercel에 등록.
- **문제:** Import 직후 배포가 시작되지 않았다(No Production Deployment). GitHub 쪽 배포와 빌드 상태를 조회해 보니 Vercel이 만든 것이 하나도 없었다. 새 커밋을 푸시하자 웹훅이 동작해 빌드가 시작되었다.
- 배포 주소를 네이버 클라우드 콘솔의 Web 서비스 URL과 Supabase의 Site URL, Redirect URLs에 추가했다. localhost 주소도 Redirect URLs에 남겨 로컬 개발이 막히지 않게 했다.
- 이후 main에 푸시하면 자동으로 배포된다. 배포 후에는 번들 파일 이름이 로컬 빌드와 같은지 비교해 새 코드가 반영됐는지 확인했다.

### 6. 편의 기능: 상태, 메모, 별점, 삭제
- places에 status(want/visited), memo, rating(1~5) 컬럼 추가. 기존 DB는 [supabase/migrations/002_place_details.sql](../supabase/migrations/002_place_details.sql)로 변경하고 schema.sql에도 반영.
- 상태 토글, 별점 선택, 메모 입력(포커스를 잃을 때 저장), 삭제(확인창). 마커 색은 상태별로 구분(가고 싶어요 빨강, 다녀왔어요 초록).
- 추가, 수정, 삭제 모두 화면에 먼저 반영하고 실패하면 되돌리는 낙관적 업데이트. 추가 중인 임시 행은 실제 행이 오기 전까지 수정과 삭제를 막는다.
- 실시간: UPDATE, DELETE도 구독. DELETE 이벤트는 삭제된 행의 id만 오고 방 필터를 쓸 수 없어서, 화면에 가진 id만 제거하는 방식으로 처리했다.
- **문제:** schema.sql을 다시 실행하자 `function is_member already exists` 오류가 났다. 테이블만 지우고 함수는 지우지 않았기 때문이다. 함수도 먼저 drop하도록 고쳤다. 또 이 스크립트는 rooms와 room_members까지 지우므로, 컬럼 추가처럼 데이터를 보존해야 하는 변경은 마이그레이션 파일로 분리했다.

### 7. 모바일 화면과 PWA
- 지도를 전체 화면으로 깔고, 위쪽에 검색창, 아래쪽에 "저장한 장소 (n)" 버튼을 두었다. 버튼을 누르면 아래에서 시트가 올라와 목록(상태, 별점, 메모, 초대 코드, 로그아웃)을 보여준다. 지도 빈 곳을 누르면 검색 결과가 닫힌다.
- 마커를 누르면 시트가 열리고 해당 장소가 강조되며 그 위치로 스크롤된다. 선택된 마커는 더 크게 그린다.
- PWA: manifest, 아이콘(192, 512, 애플 터치 180), theme-color 추가. 아이콘은 스크립트로 직접 그린 임시 디자인이다. 서비스 워커는 넣지 않았다. 실시간 동기화 앱이라 오프라인 이점이 적고, 이전 버전이 캐시에 남는 문제를 피하기 위해서다. 아이폰 Safari에서 홈 화면 추가와 실행을 확인했다.
- **문제:** 아이폰에서 검색창과 저장 버튼이 보이지 않았다. 원인을 하나로 확정하지 못해 두 가지를 함께 막았다. 전체 컨테이너를 100svh 대신 position: fixed, inset: 0으로 바꿔 뷰포트 높이 단위 차이에 의존하지 않게 했고, 지도 컨테이너에 독립된 쌓임 맥락(z-index 0, isolation)을 만들어 지도 내부 요소가 패널을 덮지 못하게 했다. 이후 정상 표시되는 것을 확인했다.

### 8. 네이버 지도로 이동
- 네이버 장소 상세(사진, 영업시간, 리뷰)는 공개 API가 없고 크롤링은 약관 위반이라 앱 안에 직접 보여주지 않고 링크로 넘긴다. 카카오와 네이버의 장소 ID가 달라 ID로 연결할 방법이 없어, 검색 주소를 만들어 여는 방식을 택했다.
- 검색창에 이름과 주소가 길게 들어가는 문제가 있었다. 검색어는 이름만 쓰고, 저장된 좌표를 지도 중심(`c=확대,경도,위도,...`)으로 넘기는 방식으로 바꾸자 깔끔해졌고 원하는 지점이 먼저 나오는 것을 확인했다. 이 주소 형식은 공식 문서로 확인한 것이 아니라 실제 동작으로 확인한 것이라, 네이버가 형식을 바꾸면 깨질 수 있다.

## 문제 해결 기록

| 상황 | 원인 | 해결 |
|---|---|---|
| 네이버 개발자센터에 검색 API가 없음 | 검색 API가 NAVER API HUB로 이전, 신규 신청 불가 | 검색만 카카오 로컬 API로 교체 |
| 공개 저장소 상태로 만들어져 있음 | 미리 만든 빈 저장소가 공개였음 | 비공개로 전환 후 푸시 |
| Vercel에서 비공개 저장소 접근 불가 | URL 입력 방식은 공개 저장소용 | GitHub 앱 권한에서 저장소 허용 후 Import |
| Import 후 배포가 시작되지 않음 | 웹훅이 동작하지 않음 | 새 커밋 푸시로 빌드 시작 |
| schema.sql 재실행 시 함수 중복 오류 | 함수를 drop하지 않음 | drop function 추가, 컬럼 추가는 마이그레이션 분리 |
| 수정 요청이 `Failed to fetch`(CORS, PATCH 불허)로 실패 | 서버는 정상 응답. 같은 헤더로 사전 요청을 재현하면 PATCH 허용. 시크릿 창에서는 정상이라 브라우저 쪽 문제로 좁힘 | 브라우저 재시작 후 해결. 앱 코드 변경 없음 |
| 웹에서 추가한 장소가 아이폰 앱에 안 나타남 | 백그라운드에서 끊긴 실시간 연결의 놓친 이벤트는 재전송되지 않음(추정) | 화면 복귀, 재연결, 온라인 복귀 시 재조회 + 새로고침 버튼 |
| 아이폰에서 검색창과 버튼이 안 보임 | 뷰포트 단위나 겹침 순서 문제로 추정 | fixed 컨테이너와 독립 쌓임 맥락 |

## 파일 구성

- [src/App.tsx](../src/App.tsx): 세션과 방 상태에 따라 Auth, RoomGate, PlaceMap 중 하나를 보여준다.
- [src/Auth.tsx](../src/Auth.tsx): 로그인, 회원가입.
- [src/RoomGate.tsx](../src/RoomGate.tsx): 방 만들기, 초대 코드 입장.
- [src/PlaceMap.tsx](../src/PlaceMap.tsx): 지도, 검색, 저장, 수정, 삭제, 실시간 구독, 시트 화면.
- [src/supabase.ts](../src/supabase.ts): Supabase 클라이언트.
- [api/search.ts](../api/search.ts): 카카오 검색을 대신 호출하는 Vercel 함수.
- [supabase/schema.sql](../supabase/schema.sql): 전체 스키마와 RLS. 다시 실행하면 places, rooms, room_members 데이터가 모두 지워진다(개발용).
- [supabase/migrations/](../supabase/migrations/): 데이터를 보존하는 변경.
- [public/manifest.webmanifest](../public/manifest.webmanifest): PWA 설정.

## 환경 변수 (`.env.local`과 Vercel, 커밋 안 됨)

| 변수 | 공개 여부 |
|---|---|
| `VITE_NAVER_MAP_CLIENT_ID` | 브라우저 노출 가능 |
| `VITE_SUPABASE_URL` | 브라우저 노출 가능 |
| `VITE_SUPABASE_ANON_KEY` | 브라우저 노출 가능 (RLS로 보호) |
| `KAKAO_REST_API_KEY` | **서버 전용, 노출 금지** |

## 다음 할 일 (체크리스트)

폰에서 써 보며 불편한 점이 생기면 아래 "사용하며 발견한 불편"에 먼저 적고, 고친 뒤 체크한다.

- [ ] 시트를 손가락으로 끌어 올리고 내리는 동작 (지금은 버튼으로만 열고 닫는다)
- [ ] 카테고리와 전화번호 저장, 카테고리 필터 (카카오 검색 응답에 있지만 저장하지 않는다)
- [ ] 방 나가기, 방 이동 (지금은 사용자당 방 1개로 고정)
- [ ] 카카오 검색 함수(api/search.ts)에 Supabase 로그인 토큰 검증 추가 (지금은 인증 없이 호출되어 남용될 수 있다)
- [ ] 테스트와 CI
- [ ] 포트폴리오용 README: 화면 GIF, 구조 그림, 기술 선택 이유. 위 "문제 해결 기록"의 항목들(검색 API 이전, 키 노출 방지, 정원 동시성, 실시간 중복, 낙관적 업데이트와 롤백)을 글로 풀어 쓴다.

### 사용하며 발견한 불편

- [x] 2026-09-30: 웹에서 추가한 장소가 아이폰 홈 화면 앱에 나타나지 않고, 홈 화면 앱에는 새로고침 수단도 없었다. 원인은 iOS가 백그라운드 앱의 실시간 연결을 끊고, 다시 열어도 그 사이에 놓친 변경을 다시 보내 주지 않는 것으로 추정(직접 재현은 못 함). 앱이 다시 화면에 보일 때, 실시간 연결이 다시 붙을 때, 네트워크가 돌아올 때 목록을 서버에서 다시 불러오도록 했고, 시트에 새로고침 버튼도 추가했다. 다시 불러올 때 서버 상태로 교체하므로 다른 곳에서 삭제된 장소도 정리된다.

## 알려진 한계

- 네이버 지도 링크는 주소 형식(`c=...`)을 공식 문서로 확인하지 못했다. 네이버가 바꾸면 깨질 수 있다.
- `PATCH` 요청이 한 번 브라우저 문제로 실패한 적이 있고 원인은 끝까지 특정하지 못했다. 같은 증상이 반복되면 수정과 삭제를 `POST` 방식의 DB 함수(RPC)로 바꾸는 우회책을 쓸 수 있다.
