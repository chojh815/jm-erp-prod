import ProductionOrderForm from "../ProductionOrderForm";

export default function ProductionOrderDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <ProductionOrderForm orderId={params.id} />;
}

