/**
 * SignatureStamp for @react-pdf/renderer
 * - Reads an image from /public and converts it to data-uri so React-PDF can embed it reliably.
 * - Default stamp path: public/images/jm_stamp_vn.jpg  (your current file)
 */
import * as React from "react";
import { Image, Text, View } from "@react-pdf/renderer";
import fs from "fs";
import path from "path";

export function loadPublicImageAsDataUri(publicRelativePath: string): string | null {
  try {
    const p = path.join(process.cwd(), "public", publicRelativePath.replace(/^\/+/, ""));
    if (!fs.existsSync(p)) return null;

    const buf = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : "application/octet-stream";

    const b64 = buf.toString("base64");
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

type SignatureStampProps = {
  /** public 기준 경로 (예: "images/jm_stamp_vn.jpg") */
  stampPath?: string;

  /** 도장 크기(px). 기본 95 */
  size?: number;

  /** 오른쪽 하단 배치용 컨테이너 폭/높이 (px) */
  boxW?: number;
  boxH?: number;

  /** Signed by 라인 표시 여부 */
  showSignedBy?: boolean;
  signedByText?: string;
  signedByName?: string | null;

  /** 외부에서 style 추가 주입 */
  style?: any;
};

export function SignatureStamp({
  stampPath = "images/jm_stamp_vn.jpg",
  size = 95,
  boxW = 260,
  boxH = 150,
  showSignedBy = false,
  signedByText = "Signed by",
  signedByName = null,
  style,
}: SignatureStampProps) {
  const uri =
    loadPublicImageAsDataUri(stampPath) ??
    loadPublicImageAsDataUri("images/jm_stamp_vn.png") ??
    loadPublicImageAsDataUri("assets/stamp.png") ??
    loadPublicImageAsDataUri("stamps/stamp.png");

  // 이미지 못 찾으면(경로/파일명 오타) -> 기존 박스 fallback
  if (!uri) {
    return (
      <View
        style={[
          {
            width: boxW,
            height: boxH,
            borderWidth: 1,
            borderColor: "#999",
            padding: 10,
            justifyContent: "space-between",
          },
          style,
        ]}
      >
        <Text style={{ fontSize: 10, fontWeight: 700 }}>Authorized Signature</Text>
        <Text style={{ fontSize: 9, color: "#666" }}>
          (stamp image not found: {stampPath})
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        {
          width: boxW,
          height: boxH,
          borderWidth: 0, // ✅ 박스 제거(도장만)
          padding: 0,
          justifyContent: "flex-end",
          alignItems: "flex-end",
        },
        style,
      ]}
    >
      <Image
        src={uri}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
        }}
      />

      {showSignedBy ? (
        <View style={{ marginTop: 6, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 9 }}>{signedByText}</Text>
          {signedByName ? <Text style={{ fontSize: 9 }}>{signedByName}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
