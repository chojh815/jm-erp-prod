import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VIRTUAL_EXPENSE_TYPES: Record<
  string,
  {
    code: string;
    name: string;
    category: string;
    default_scope: string;
    default_allocation: string;
  }
> = {
  FREIGHT: {
    code: "FREIGHT",
    name: "Freight / Air / Ocean",
    category: "LOGISTICS",
    default_scope: "SHIPMENT",
    default_allocation: "BY_CBM",
  },
};

export async function ensureExpenseTypeCodeExists(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;

  const existing = await supabaseAdmin
    .from("expense_types")
    .select("code")
    .eq("code", normalized)
    .limit(1);

  if (!existing.error && existing.data?.[0]?.code) {
    return existing.data[0].code;
  }

  const virtualType = VIRTUAL_EXPENSE_TYPES[normalized];
  if (!virtualType) return null;

  const { data, error } = await supabaseAdmin
    .from("expense_types")
    .insert({
      code: virtualType.code,
      name: virtualType.name,
      category: virtualType.category,
      default_scope: virtualType.default_scope,
      default_allocation: virtualType.default_allocation,
      is_active: true,
    })
    .select("code")
    .single();

  if (error) throw error;
  return data?.code || normalized;
}

export async function resolveExpenseTypeCodeForSave(raw: any): Promise<string | null> {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  const normalized = input.toUpperCase().replace(/\s+/g, "_");

  if (normalized === "FREIGHT") {
    return await ensureExpenseTypeCodeExists("FREIGHT");
  }

  if (normalized === "FORWARDER" || normalized === "FORWARDER_SERVICE") {
    return "FORWARDER";
  }

  const exactCode = await supabaseAdmin.from("expense_types").select("code").ilike("code", input).limit(1);
  if (!exactCode.error && exactCode.data?.[0]?.code) return exactCode.data[0].code;

  const exactName = await supabaseAdmin.from("expense_types").select("code").ilike("name", input).limit(1);
  if (!exactName.error && exactName.data?.[0]?.code) return exactName.data[0].code;

  const safe = input.replace(/%/g, "");
  const loose = await supabaseAdmin
    .from("expense_types")
    .select("code")
    .or(`code.ilike.%${safe}%,name.ilike.%${safe}%`)
    .limit(1);
  if (!loose.error && loose.data?.[0]?.code) return loose.data[0].code;

  return null;
}
