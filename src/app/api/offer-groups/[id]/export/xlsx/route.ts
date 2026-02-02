import { NextResponse } from "next/server";
import { createSupabaseServerClient, getAuthUserOrThrow } from "@/lib/offerGroupsServer";

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServerClient();
    await getAuthUserOrThrow(supabase);
    const id = params.id;

    const { data: header, error: hErr } = await supabase
      .from("offer_groups")
      .select("*")
      .eq("id", id)
      .eq("is_deleted", false)
      .single();
    if (hErr) throw hErr;

    const { data: items, error: iErr } = await supabase
      .from("offer_group_items")
      .select("*")
      .eq("offer_group_id", id)
      .eq("is_deleted", false)
      .order("sort_no", { ascending: true });
    if (iErr) throw iErr;

    const itemIds = (items ?? []).map((x: any) => x.id);
    const { data: pk, error: pErr } = itemIds.length
      ? await supabase
          .from("offer_group_item_packages")
          .select("*")
          .in("item_id", itemIds)
          .eq("is_deleted", false)
      : { data: [], error: null as any };
    if (pErr) throw pErr;

    // Build grid: columns = [No, Style, ImageURL, Material, Size, Remark] + per package (FOB, MOQ)
    const packages = pk ?? [];
    const packageTypes = uniq(packages.map((p: any) => p.package_type)).sort();

    // Try to import xlsx
    let XLSX: any = null;
    try {
      XLSX = await import("xlsx");
    } catch {
      return NextResponse.json(
        { success: false, error: "Missing dependency: xlsx. Run: npm i xlsx" },
        { status: 500 }
      );
    }

    const rows: any[] = [];
    for (let idx = 0; idx < (items ?? []).length; idx++) {
      const it: any = (items ?? [])[idx];
      const row: any = {
        NO: idx + 1,
        STYLE: it.style_no ?? "",
        IMAGE_URL: it.image_url ?? "",
        MATERIAL: it.material_summary ?? "",
        SIZE: it.size_summary ?? "",
        REMARK: it.remark ?? "",
      };
      for (const pt of packageTypes) {
        const found = packages.find((p: any) => p.item_id === it.id && p.package_type === pt);
        row[`${pt} FOB`] = found?.fob_price ?? "";
        row[`${pt} MOQ`] = found?.moq ?? "";
      }
      rows.push(row);
    }

    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Offer");

    // Add simple header info in a separate sheet
    const meta = [
      { key: "Buyer", value: header?.buyer_name ?? "" },
      { key: "Buyer Code", value: header?.buyer_code ?? "" },
      { key: "Currency", value: header?.currency ?? "USD" },
      { key: "Title", value: header?.title ?? "" },
      { key: "Status", value: header?.status ?? "DRAFT" },
      { key: "Memo", value: header?.memo ?? "" },
    ];
    const ws2 = XLSX.utils.json_to_sheet(meta, { header: ["key", "value"] });
    XLSX.utils.book_append_sheet(wb, ws2, "Meta");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="OfferGroup-${header?.buyer_code ?? "GROUP"}-${id}.xlsx"`,
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Failed";
    const status = /unauthorized/i.test(msg) ? 401 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
