# Development & Samples: 자료·협의 이력

## 사용 흐름

1. 관리자가 기존 Sample Requests 메뉴에서 개발건을 생성한다. Title(예: PET COLLAR 개발건), 바이어, 요청 유형(가격조사/샘플개발/둘 다), 회신 목표일 및 진행 상태를 입력한다.
2. 개발건을 선택하고 `자료·협의 이력`을 연다. 관리자 설정에서 Sub Title(예: CHAIN COLLAR, SNAP ON COLLAR)을 만들고 기존 ERP 직원 계정을 담당 직원으로 배정한다.
3. 배정된 직원이 자신의 ERP 계정으로 로그인하여 개발건을 선택한다. Sub Title, 받은 날짜, 제목, 자료 종류, 전달 경로, 보낸 사람, 메모와 원본 파일을 등록한다. 등록자와 등록 시각은 서버에서 기록한다.
4. 변경 자료는 기존 자료의 `수정본 등록`으로 추가한다. 기존 기록과 파일은 덮어쓰지 않으며 수정본이 이전 기록에 연결된다. 엑셀 양식은 통일하지 않아도 된다.
5. 받은 날짜 범위, Sub Title, 제목/파일명/메모/보낸 사람/등록자로 찾고, 미리보기 또는 원본 다운로드를 사용한다. 바이어 협의 내용이나 진행 상황은 파일 없이 메모로 남길 수 있다.

관리자/owner/manager는 기존 Sample Requests 권한에 따라 요청 정보와 담당자를 관리한다. staff는 메뉴 조회 권한과 해당 요청의 배정(또는 기존 owner_id/owner_email)이 있어야 자료를 등록할 수 있다. viewer는 배정된 요청을 조회만 한다. 신규 이력의 `관리자만` 자료는 관리 역할만 조회한다. 기존 담당자로 남아 있는 직원의 접근을 제거하려면 담당자 정보도 변경해야 한다.

## 적용 순서

현재 구현은 로컬 코드이며 운영 DB 초기 설정과 배포가 필요하다.

1. 운영 Supabase 프로젝트의 SQL Editor에서 `supabase/migrations/20261031000100_sample_request_history.sql` 전체를 실행한다. 기존 sample_requests 및 auth/storage 스키마가 있어야 한다. 트랜잭션으로 실행되며 재실행 가능하다.
2. 테이블 3개(sample_request_topics/members/history), sample_requests.request_kind 및 비공개 Storage 버킷(sample-request-history)이 생성되었는지 확인한다. 서비스 역할 키는 서버 환경 변수 SUPABASE_SERVICE_ROLE_KEY에만 둔다. 기존 프로젝트의 NEXT_PUBLIC_SUPABASE_URL 및 NEXT_PUBLIC_SUPABASE_ANON_KEY도 필요하다.
3. 애플리케이션을 배포한다. 관리자와 실제 배정 직원 계정으로 아래 운영 연결 검증을 수행한다.

현재 환경의 DATABASE_URL은 예시값이고 Supabase CLI 로그인 토큰도 없어 운영 SQL 실행 및 운영 연결 검증은 수행하지 못했다. 운영 자격 증명을 소스나 대화에 붙여 넣지 않는다.

## 운영 연결 검증

- 관리자: 개발건과 Sub Title을 만들고 직원 A를 배정한다.
- 직원 A: 원본 Excel을 등록하고 새 수정본을 연결한다. 두 기록이 모두 남고 등록자가 직원 A로 기록되는지 확인한다.
- 직원 B: 배정되지 않은 요청과 해당 파일 URL에 접근할 수 없는지 확인한다.
- 관리자: `관리자만` 이력을 등록하고 직원 A에게 보이지 않는지 확인한다.
- Excel 미리보기에서 시트를 바꾸고 원본을 내려받아 원래 파일이 보존되는지 확인한다.
- 5MB 이상 Excel도 업로드하여 API 요청 본문 제한을 거치지 않는 직접 Storage 전송을 확인한다.

## 저장 및 미리보기 범위

신규 이력 파일은 비공개 버킷에 원본으로 보관하며, 다운로드 시 권한을 다시 확인한 뒤 5분 유효 링크를 발급한다. 최대 5개, 각 40MiB이며 xlsx/xls/csv/pdf/png/jpg/jpeg/webp/gif/txt/docx를 허용한다. 기존 요청 정보 탭의 첨부파일 저장 방식이나 기존 공개 파일 URL을 마이그레이션하지 않는다.

Excel 미리보기는 선택 시트의 첫 100행·20열 값만 표시한다. 이미지·병합·정확한 서식·수식 재계산은 지원하지 않으므로 실제 오퍼 작업에는 원본을 내려받는다. PDF·이미지는 브라우저에서 미리 볼 수 있으며 기타 형식은 원본 다운로드를 사용한다.

새 이력에는 수정/삭제 API를 제공하지 않는다. 실패한 업로드나 등록 전에 이탈한 파일이 Storage에 남을 수 있으므로 운영 용량 관리 시 참조되지 않은 파일을 별도 점검한다.

## 로컬 검증

`node --test tests/api-identity.test.cjs tests/sample-request-history.test.cjs tests/po-amounts.test.cjs tests/shipping-quantities.test.cjs`

`node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`

이력/API 테스트는 실제 라우트 코드와 모의 DB/Storage를 사용한다. SQL은 격리된 PostgreSQL 호환 PGlite에서 두 번 실행하여 재실행 및 RLS/비공개 버킷 생성을 검증했다. 운영 계정·Storage의 실제 연결 검증은 위 절차에 따라 별도로 수행한다.
