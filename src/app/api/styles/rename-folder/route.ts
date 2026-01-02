import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET_NAME = "style-images";

export async function POST(req: NextRequest) {
  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            "Supabase environment variables are not set (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
        },
        { status: 500 }
      );
    }

    const { oldStyleNo, newStyleNo } = await req.json();

    if (!oldStyleNo || !newStyleNo) {
      return NextResponse.json(
        { error: "oldStyleNo and newStyleNo are required." },
        { status: 400 }
      );
    }

    const safeOld =
      String(oldStyleNo).trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "no-style";
    const safeNew =
      String(newStyleNo).trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "no-style";

    if (safeOld === safeNew) {
      return NextResponse.json({ success: true, moved: 0 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1) 예전 폴더 파일 리스트
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(safeOld, {
        limit: 1000,
        offset: 0,
      });

    if (listError) {
      console.error("Storage list error:", listError);
      return NextResponse.json(
        { error: "Failed to list files in old style folder." },
        { status: 500 }
      );
    }

    if (!files || files.length === 0) {
      return NextResponse.json({ success: true, moved: 0 });
    }

    // 2) 각 파일 복사 → 새 폴더
    let movedCount = 0;
    for (const file of files) {
      const fromPath = `${safeOld}/${file.name}`;
      const toPath = `${safeNew}/${file.name}`;

      const { error: copyError } = await supabase.storage
        .from(BUCKET_NAME)
        .copy(fromPath, toPath);

      if (copyError) {
        console.error("Copy error:", copyError, "for", fromPath);
        continue;
      }

      movedCount++;
    }

    // 3) 옛 폴더의 파일 삭제
    const { error: removeError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove(
        files.map((f) => `${safeOld}/${f.name}`)
      );

    if (removeError) {
      console.error("Remove old folder error:", removeError);
      // 복사는 성공했으니, 삭제 에러는 치명적이진 않음
    }

    return NextResponse.json({ success: true, moved: movedCount });
  } catch (err) {
    console.error("Rename folder error:", err);
    return NextResponse.json(
      { error: "Unexpected server error while renaming style folder." },
      { status: 500 }
    );
  }
}
