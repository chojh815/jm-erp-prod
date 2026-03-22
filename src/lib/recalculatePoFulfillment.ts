import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function recalculatePoFulfillmentByShipment(shipmentId: string) {
  const { data, error } = await supabaseAdmin.rpc("recalculate_po_fulfillment_by_shipment", {
    p_shipment_id: shipmentId,
  });
  if (error) throw new Error(error.message || "Failed to recalculate PO fulfillment by shipment");
  return data;
}

export async function recalculatePoFulfillment(poHeaderId: string) {
  const { data, error } = await supabaseAdmin.rpc("recalculate_po_fulfillment", {
    p_po_header_id: poHeaderId,
  });
  if (error) throw new Error(error.message || "Failed to recalculate PO fulfillment");
  return data;
}
