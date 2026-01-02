// checkEnvFull.ts
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// ✅ .env.local 을 명시적으로 로드
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

console.log("🔍 Supabase 환경변수 및 .env.local 경로 점검 시작...\n");

const cwd = process.cwd();
const envPath = path.join(cwd, ".env.local");

// 1) 파일 존재 확인
if (!fs.existsSync(envPath)) {
  console.error(`❌ .env.local 파일이 없습니다.\n📁 현재 경로: ${cwd}\n`);
  process.exit(1);
}
console.log(`✅ .env.local 파일 발견됨: ${envPath}`);

// 2) 내용 읽어 미리보기 (키는 마스킹)
const envContent = fs.readFileSync(envPath, "utf-8").trim();
if (!envContent) {
  console.error("⚠️ .env.local 파일이 비어 있습니다.");
  process.exit(1);
}

// 3) 환경변수 체크
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url) console.error("❌ NEXT_PUBLIC_SUPABASE_URL 이 설정되지 않았습니다.");
else console.log("✅ NEXT_PUBLIC_SUPABASE_URL:", url);

if (!key) console.error("❌ NEXT_PUBLIC_SUPABASE_ANON_KEY 가 설정되지 않았습니다.");
else console.log("✅ NEXT_PUBLIC_SUPABASE_ANON_KEY: OK (길이:", key.length, ")");

// 4) 요약
console.log("\n=============================");
if (url && key) {
  console.log("🎉 모든 환경변수가 정상적으로 인식되었습니다!");
} else {
  console.log("⚠️  일부 환경변수가 인식되지 않았습니다. .env.local 내용을 다시 확인하세요.");
}
console.log("=============================\n");

// 5) 내용 미리보기
console.log("📄 .env.local 내용 미리보기:");
const preview = envContent
  .split("\n")
  .map((line) =>
    line.startsWith("NEXT_PUBLIC_SUPABASE_ANON_KEY")
      ? "NEXT_PUBLIC_SUPABASE_ANON_KEY=********(생략됨)"
      : line
  )
  .join("\n");
console.log(preview);
