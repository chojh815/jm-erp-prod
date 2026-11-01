"use client";
import { useParams } from "next/navigation";
import GeneralQuoteEditor from "@/components/quotation/GeneralQuoteEditor";
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <GeneralQuoteEditor key={id} id={id} />;
}
