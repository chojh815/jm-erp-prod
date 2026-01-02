import { redirect } from "next/navigation";
export default function Root() {
  redirect("/login"); // 루트 접근 시 로그인 페이지로
}
