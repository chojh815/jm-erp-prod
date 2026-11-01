# 일반 Quotation 수정 및 적용 안내

상태: 구현·로컬 검증 완료. 운영 DB 마이그레이션과 배포는 아직 수행하지 않았다.

## 반영한 조치

| 검토에서 확인한 문제 | 수정 |
|---|---|
| 일부 관리 API에 로그인·권한 확인 없음 | Quotation 조회·생성·저장·삭제·출력·Costing 검색·첨부 경로 모두 공통 서버 권한 검사. 기존 dev.costings 권한을 사용하며 개인 권한 취소도 반영 |
| PDF·Excel에 내부 원가/마진 노출 | 바이어 출력은 명시적으로 선별한 공개 필드만 사용. 내부 원가·FX·마진·타깃 단가 제외. Excel은 실제 XLSX |
| 상세 화면 API 3개 없음 | 상세 화면은 단일 통합 GET 사용. 이전 lines/variants/variant-lines GET도 권한 확인을 거쳐 호환 응답 제공 |
| 화면 저장 형식 불일치 | document/version_id/revision을 함께 전송. 이전 flat header 저장은 성공으로 위장하지 않고 새로고침 요청 오류 반환 |
| 생성·조회·PDF·Excel 소스 불일치 | 버전별 quotation_versions.document가 공통 기준. 화면·PDF·XLSX 모두 같은 버전의 저장 단가·통화·단위 사용 |
| Costing 가격·실제 버전 복사 누락 | 저장된 offer_usd(없을 때 offer_price_usd), 실제 version, 당시 전체 Costing 헤더와 FX·마진 근거 복사. 선택 후 Costing이 달라지면 충돌 안내 |
| SENT 잠금/다른 견적 행/음수 검증 없음 | 발송/확정본 변경 차단, quotation_line_keys로 행의 견적 소속 고정, 유효 단가·수량·날짜·중복 MOQ 검사 |
| 저장·생성 실패 시 일부만 잔존 | 단일 SQL RPC의 트랜잭션. 오류 시 전체 복원. revision으로 동시 수정 덮어쓰기 방지 |
| 실제 삭제 fallback/첨부 유실 가능 | Archive/Restore 통일, 견적 이력 실제 삭제 차단. 첨부는 비공개 직접 업로드·서버 검증·버전별 보존. 수정본에 첨부도 복사 |

RED 전용 메뉴는 그대로 유지한다. 일반 Quotation의 예전 RED Matrix 복제 컴포넌트는 제거했으며 새 일반 견적 화면은 RED 가격 API를 호출하지 않는다.

## 사용 흐름

1. Quotations → New Quotation에서 바이어·제목·통화·조건을 입력한다.
2. Style 행을 직접 입력하거나 Costing 검색에서 정확한 스타일/원가 버전을 골라 추가한다. Costing의 저장 오퍼는 USD 기준으로 복사한다. 타깃 가격과 최종 오퍼는 별도이며 타깃을 오퍼로 자동 간주하지 않는다.
3. 각 행의 수량·가격 단위·최종 오퍼를 확인하고 필요한 MOQ별 가격/선적지를 추가한다. 단가 정밀도는 저장 값을 보존하고 금액은 소수점 둘째 자리로 표시한다.
4. 견적 전체를 저장한 후 행별 파일을 업로드한다. 파일은 행당 10개, 파일당 10MB다. 허용 형식은 pdf/png/jpg/jpeg/webp/xlsx/xls/csv/doc/docx/txt다. Storage에 직접 전송하므로 Vercel API 본문에 큰 파일을 넣지 않는다.
5. 저장된 버전으로 PDF 인쇄 또는 XLSX를 출력한다. 내부 원가 근거는 화면의 접힌 내부 자료 영역에만 표시하며 바이어 출력에는 넣지 않는다. MOQ는 대안 단가로 표시하고 기본 행 수량의 합계에 중복 합산하지 않는다.
6. 발송본 기록·잠금은 상태·발송 시각·담당자를 기록한다. 실제 메일 전송은 수행하지 않는다. 이후 변경은 수정본을 만들고 이유/네고 내용을 기록한다.
7. 보관은 목록에서 Archive, 복원은 보관함에서 Restore를 사용한다. 발송본 가격과 과거 첨부는 수정하지 않는다.

견적 통화 변경은 자동 환산이 아니다. 이미 입력한 가격이 있으면 사용자 확인을 받고 새 통화에 맞는 단가 확인을 요구한다. 신규 견적번호는 Q-YYMM-순번으로 원자적으로 발급하며 기존 견적번호는 유지한다.

## 기존 자료 보존과 확인

기존 quotation_lines/items/variants/variant_lines 행은 삭제하거나 임의 합산하지 않는다. 마이그레이션은 기존 헤더별 v1 메타데이터와 헤더 스냅샷을 만든다. 기존 원가/가격 테이블은 이후 조회용으로 보존하고 쓰기를 차단한다. quote_accounts를 통해 연결된 기존 바이어도 가능한 범위에서 v1 헤더 스냅샷에 보존한다.

서로 다른 가격 원본이 있거나 오퍼·스타일·통화가 불명확한 경우 화면에서 출처를 선택하고 확인해야 저장할 수 있다. 발송/확정본은 수정본을 만든 뒤 확인한다. 가격 없는 기존 Items를 현재 Costing 가격으로 소급 채우지 않는다. 과거 저장 실패로 헤더만 남은 견적도 빈 원본 확인 상태로 열어 원본을 참고해 입력하거나 보관할 수 있다.

이미 발송한 기존 견적이 여러 출처로 충돌하는 경우 임의로 과거 PDF를 재현하지 않으며 확인 전 출력은 거절한다. 수정본은 원본의 가격 출처와 변경 이유를 남긴다.

기존 quotation-attachments 파일은 기존 경로를 보존하고 해당 v1에 연결한다. 새 파일은 quotation-version-files 비공개 버킷에 저장한다. 다운로드는 사용자 권한을 다시 확인한 후 5분 유효 링크로 제공한다. DRAFT에서 첨부를 제외해도 과거 버전의 파일이나 Storage 원본을 물리 삭제하지 않는다. 중간에 실패한 미등록 업로드는 Storage에 남을 수 있다.

## 운영 적용

1. 같은 JM_ERP_V2 Supabase 프로젝트의 SQL Editor에서 **새 쿼리**를 열고 `supabase/migrations/20261101000100_general_quotation_integrity.sql` 전체(begin~commit)를 실행한다. RED나 Sample Requests SQL을 다시 실행하는 작업이 아니다. 이 SQL은 기존 일반 견적 데이터를 보존하고 새 버전·권한·보호 함수와 비공개 저장소를 추가한다.
2. DB 적용과 코드 배포를 이어서 수행한다. 적용 후 이전 일반 견적 화면의 저장은 보호 트리거에 의해 거절될 수 있으므로 배포 후 브라우저를 새로고침한다.
3. 관리자/담당자 계정에서 실제 운영 연결을 확인한다: 신규 견적 → 정확한 Costing 버전 선택 → 최종 단가 저장 → 재조회/XLSX/PDF 일치 → 파일 업로드 → 수정본과 첨부 복사 → 발송본 잠금 → 오래된 창 저장 충돌 → 보관/복원.

현재 환경은 운영 SQL을 실행할 PostgreSQL 연결/CLI 로그인이 없어 운영 적용은 수행하지 않았다. 브라우저 전체 사용자 흐름과 새 버킷의 실제 업로드도 운영 DB 적용 후 확인해야 한다.

## 검증

- 애플리케이션 테스트 전체 118개 통과. 일반 Quotation 신규 30개, 기존 RED/Sample Requests/로그인 권한/PO/선적 수량 테스트 포함.
- PostgreSQL 호환 PGlite에서 일반 Quotation 마이그레이션 두 번 실행 및 19개 DB 검증 통과: 트랜잭션 복원, 동시 수정, 행 소속, 발송본/파일 잠금, 복사/첨부 보존, 보관/복원, 일반 클라이언트 RPC 거절, 서버 역할 권한.
- 기존 RED DB 검증 18개 재확인 통과.
- TypeScript 검사 통과.
- 전체 Next.js 빌드는 격리된 복사본에서도 Windows EPERM(`.next/server/app/admin` 디렉터리 생성) 오류로 완료하지 못했다. 빌드 성공으로 보고하지 않으며 운영 배포 빌드 확인이 남아 있다.

```powershell
node --test tests/api-identity.test.cjs tests/general-quotation.test.cjs tests/red-quotation.test.cjs tests/sample-request-history.test.cjs tests/po-amounts.test.cjs tests/shipping-quantities.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
$env:RED_TEST_PGLITE_MODULE='개발용 설치 위치/node_modules/@electric-sql/pglite'
node tests/general-quotation.database.cjs
```

PGlite는 검증용 별도 설치 위치를 사용하며 운영 패키지 의존성에 추가하지 않았다.
