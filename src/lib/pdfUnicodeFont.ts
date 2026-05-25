import jsPDF from "jspdf";

const FONT_FAMILY = "NotoSansKR";
let fontDataPromise: Promise<{ regular: string; bold: string }> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchFontBase64(path: string) {
  const res = await fetch(path, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Failed to load PDF font: ${path}`);
  return arrayBufferToBase64(await res.arrayBuffer());
}

export async function useUnicodePdfFont(doc: jsPDF) {
  if (!fontDataPromise) {
    fontDataPromise = (async () => {
      const [regular, bold] = await Promise.all([
        fetchFontBase64("/fonts/NotoSansKR-Regular.ttf"),
        fetchFontBase64("/fonts/NotoSansKR-Bold.ttf"),
      ]);
      return { regular, bold };
    })();
  }

  const { regular, bold } = await fontDataPromise;
  doc.addFileToVFS("NotoSansKR-Regular.ttf", regular);
  doc.addFont("NotoSansKR-Regular.ttf", FONT_FAMILY, "normal");
  doc.addFileToVFS("NotoSansKR-Bold.ttf", bold);
  doc.addFont("NotoSansKR-Bold.ttf", FONT_FAMILY, "bold");
  doc.setFont(FONT_FAMILY, "normal");
  return FONT_FAMILY;
}
