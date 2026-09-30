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
| Vercel | 배포 예정 | https://vercel.com |

## 구조

| 역할 | 사용 기술 |
|---|---|
| 프론트엔드 | React + TypeScript (Vite) |
| 지도 표시 | 네이버 Dynamic Map |
| 장소 검색 | 카카오 로컬 API (키워드 검색) |
| DB / 인증 / 실시간 | Supabase (Postgres, Auth, Realtime, RLS) |
| 검색 API 키 보호 | Vite 개발 서버 프록시 (배포 시 Vercel 함수로 교체 예정) |

```
브라우저 ──> 네이버 지도 (Client ID, 공개 가능)
   │
   ├──> /api/kakao ──(Vite 프록시, 서버에서 REST 키 추가)──> 카카오 로컬 API
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

## 파일 구성

- [src/App.tsx](../src/App.tsx): 세션과 방 상태에 따라 Auth, RoomGate, PlaceMap 중 하나를 보여준다.
- [src/Auth.tsx](../src/Auth.tsx): 로그인, 회원가입.
- [src/RoomGate.tsx](../src/RoomGate.tsx): 방 만들기, 초대 코드 입장.
- [src/PlaceMap.tsx](../src/PlaceMap.tsx): 지도, 검색, 저장, 실시간 구독.
- [src/supabase.ts](../src/supabase.ts): Supabase 클라이언트.
- [supabase/schema.sql](../supabase/schema.sql): 스키마와 RLS. 다시 실행하면 `places` 데이터가 지워진다(개발용).

## 환경 변수 (`.env.local`, 커밋 안 됨)

| 변수 | 공개 여부 |
|---|---|
| `VITE_NAVER_MAP_CLIENT_ID` | 브라우저 노출 가능 |
| `VITE_SUPABASE_URL` | 브라우저 노출 가능 |
| `VITE_SUPABASE_ANON_KEY` | 브라우저 노출 가능 (RLS로 보호) |
| `KAKAO_REST_API_KEY` | **서버 전용, 노출 금지** |

## 알려진 한계와 다음 할 일

- 카카오 프록시가 Vite 개발 서버에서만 동작한다. 배포하려면 Vercel 함수로 교체해야 한다.
- 방 나가기, 삭제, 방 이동이 없다. 장소 삭제와 수정도 없다.
- 다녀왔어요 상태, 메모, 별점, 카테고리 필터가 없다.
- 모바일 UI(바텀시트, 마커와 목록 연동)와 PWA가 없다.
- 테스트와 CI가 없다.
- 포트폴리오용 README(화면 GIF, 구조 그림, 기술 선택 이유)가 아직 없다. 위의 "문제 → 결정" 항목들(검색 API 이전, 키 노출 방지, 정원 동시성, 실시간 중복)을 글로 풀어 쓰면 된다.
