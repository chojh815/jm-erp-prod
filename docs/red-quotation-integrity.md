# RED Quotation — 7개 항목 수정 및 적용 안내

현재 상태: C:/jmerp 소스와 DB 마이그레이션 작성·로컬 검증 완료. 운영 DB 적용과 배포는 아직 수행하지 않았다.

## 수정 내역

| 요청 항목 | 반영 내용 |
|---|---|
| Offer USD·환율·마진 저장 누락 | 버전별 단일 문서에 원가 통화, 개당 원가, 포장비, 환율, 매출총이익률, 기본/보정 원가, 최종 USD 오퍼를 함께 저장. 서버에서 최종 오퍼 재계산 |
| Compare / Diff 변경 누락 | 패키지·PCS·MOQ 키를 통일. 최종 USD 오퍼 비교, 기본/Override 원가 변경 표시. 복원할 수 없는 기존 오퍼는 확인 필요로 표시 |
| 새 버전 복사 누락 | 두 수정본 생성 경로를 동일한 DB 트랜잭션으로 통일. 모든 패키지와 입력·가격 복사, 원본 버전 연결, 수정 이유 보관. 응답 id 통일 |
| 최신 버전 선택 반대 | version_no를 명시적으로 정렬. 최신 DRAFT를 기본 선택하고 없으면 최신 버전 선택. 새 수정본 생성 후 해당 버전 선택 |
| 확정·발송본 잠금 없음 | 통합 저장 API/DB에서 DRAFT만 변경 허용. SENT/CONFIRMED 버전 불변 처리. 발송본 기록·잠금 버튼과 발송 시각/담당자 기록 추가 |
| 삭제 후 저장으로 가격 유실 | 기존 가격을 삭제하지 않는 원자적 문서 저장. 트랜잭션 실패 시 롤백. 저장 revision을 통한 동시 수정 충돌 감지. 잘못된 셀은 전체 저장 거절 |
| 견적 실제 삭제 | Delete를 Archive로 변경. 보관함·Restore 추가. API는 보관 처리만 수행하고 DB는 견적/버전/문서 실제 삭제 차단 |

화면의 저장되지 않은 변경은 표시되며 출력·발송본 기록 전에 저장해야 한다. 버전 변경, 탭 이동, Back 및 브라우저 새로고침 때 저장하지 않은 내용의 유실을 확인하도록 했다.

## 가격과 출력 기준

원가 기준 통화는 CNY 또는 USD다. Override는 기존 동작과 같이 **원가 보정 값**이다. 바이어 최종 USD 오퍼를 직접 넣는 칸으로 의미를 바꾸지 않았다.

`최종 USD / pkg = 보정 원가(없으면 기본 원가) ÷ 환율 ÷ (1 − 매출총이익률 / 100)`

USD 원가는 환율 1을 적용한다. 매출총이익률 20%는 원가에 20%를 가산하는 Markup과 다르다. 원가 CNY 72, 환율 7.20, 매출총이익률 20%일 때 최종 USD 오퍼는 12.50이다. 최종 가격은 소수점 2자리로 보존한다.

화면 미리보기와 저장 서버는 같은 계산 함수를 사용한다. Excel/PDF는 저장된 최종 가격을 출력한다. Excel은 CSV 대신 실제 XLSX이며 견적번호·버전·바이어·날짜·제목·스타일·선적지·조건·패키지·PCS·MOQ·USD/pkg를 포함한다. 내부 원가·Override·환율·마진은 바이어 출력에 포함하지 않는다. 제목·스타일·선적지 등 출력 정보는 가격 저장 당시의 스냅샷을 사용한다. DRAFT에서 견적 정보를 변경했으면 가격도 다시 저장하여 해당 버전의 출력 정보에 반영한다. 발송본은 이후 견적 헤더가 바뀌어도 기존 스냅샷으로 출력된다.

현재 XLSX는 공통 견적서 1종이다. 품목별 사진·서식과 기존 바이어 Excel 템플릿 매핑은 이번 7개 수정의 범위에 포함하지 않았다.

## 기존 자료 처리

기존 가격·원가·포장비 행은 삭제하거나 변환하지 않는다. 신규 문서가 없는 버전은 기존 v2 Matrix, 원가·포장비에서 읽는다. v1만 v2 데이터가 없을 때 기존 legacy Matrix도 조회한다.

과거 환율·마진이 저장되지 않은 버전의 USD 오퍼는 추정하지 않는다. DRAFT는 해당 입력을 확인한 뒤 통합 저장하고, 이미 발송/확정된 기존 버전은 수정본을 만들어 확인·저장한다. 복원 근거가 없는 최종 USD 오퍼는 출력하지 않는다.

DB 적용 후 기존 가격 테이블 4개는 조회용으로 남는다. 이전 브라우저의 분리 저장 요청과 legacy autofill은 오류를 반환하고 기존 자료를 보존한다. 새 화면으로 새로고침해야 통합 저장이 가능하다. 기존 테이블을 갱신하는 외부 도구가 있다면 새 문서 저장 경로로 전환해야 한다.

## 운영 적용 순서

1. Supabase SQL Editor에서 `supabase/migrations/20261031000200_red_quotation_integrity.sql` 전체를 실행한다. 하나의 트랜잭션이며 재실행 가능하다. 기존 RED 테이블 구조를 전제로 한다. 새 `red_quotation_documents` 테이블, 보관/발송 기록 컬럼, 원자적 저장·복사 함수 및 보호 트리거를 만든다. Sample Requests 마이그레이션과는 별개다.
2. 이 코드와 함께 배포한 후 열려 있는 RED Quotation 화면을 새로고침한다. 기존 화면의 저장은 DB 보호에 의해 거절될 수 있으므로 적용과 배포를 이어서 진행한다.
3. 실제 관리자/담당자 계정으로 아래 운영 연결 확인을 수행한다. 현재 로컬 환경의 DATABASE_URL은 예시값이고 Supabase CLI 토큰도 없어 SQL을 운영 DB에서 실행하지 못했다.

운영 연결 확인: DRAFT에서 CNY 72/환율 7.20/이익률 20%를 저장하고 재접속·XLSX·PDF에서 12.50 일치 확인 → 수정본 생성 및 Override 변경 비교 → 발송본 기록 후 변경 거절 → 두 창에서 수정하여 오래된 창의 저장 거절 → 보관함 이동/복원 및 과거 자료 보존 확인.

발송본 기록 버튼은 발송 상태와 시각·담당자를 기록하고 가격을 잠그는 기능이다. 실제 메일·위챗 전송은 수행하지 않는다.

## 검증 결과와 제한

- 애플리케이션/API·계산·Excel·PDF 테스트 88개 통과. 이 중 RED 신규 테스트는 23개다. 기존 Sample Requests, 로그인 권한, PO 금액, 선적 수량 테스트를 포함했다.
- PostgreSQL 호환 PGlite에서 SQL을 두 번 실행하고 DB 검증 18개 통과. 실제 SQL 트랜잭션의 저장 실패 롤백, revision 충돌, 발송본 변경 거절, 삭제 거절, 전체 복사, 보관/복원, 익명/일반 클라이언트 RPC 거절, 서버 역할의 생성/저장 권한을 확인했다.
- TypeScript 검사 통과.
- 전체 Next.js 빌드는 Windows 파일 쓰기 권한 오류(EPERM)로 완료하지 못했다. 기존 `.next`와 별도 임시 프로젝트에서 모두 디렉터리 생성이 거절됐다. 빌드 성공으로 보고하지 않는다.
- 운영 DB 연결과 실제 브라우저 전체 흐름은 미검증이다. 연결된 Whale 창 접근을 재시도했지만 `window id 264218 no longer belongs to Naver_Whale; current owner is Naver_Whale` 오류가 반복되어 UI 경로로 운영 설정을 확인하지 못했다.

재현 가능한 명령:

```powershell
node --test tests/api-identity.test.cjs tests/sample-request-history.test.cjs tests/red-quotation.test.cjs tests/po-amounts.test.cjs tests/shipping-quantities.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
```

DB 검증은 개발용 `@electric-sql/pglite` 패키지가 필요하며 운영 의존성에는 추가하지 않았다. 별도 설치 위치를 지정해 실행할 수 있다.

```powershell
$env:RED_TEST_PGLITE_MODULE='설치 위치/node_modules/@electric-sql/pglite'
node tests/red-quotation.database.cjs
```
