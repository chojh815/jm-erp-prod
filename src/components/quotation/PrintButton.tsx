"use client";

import * as React from "react";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        padding: "10px 16px",
        borderRadius: 8,
        border: "1px solid #111",
        background: "#111",
        color: "#fff",
        cursor: "pointer",
      }}
    >
      Print
    </button>
  );
}