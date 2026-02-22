"use client";

import AppShell from "@/components/layout/AppShell";
import ExpenseForm from "../_components/ExpenseForm";

export default function NewExpensePage() {
  return (
    <AppShell title="Finance / Expenses / New">
      <ExpenseForm mode="create" />
    </AppShell>
  );
}
