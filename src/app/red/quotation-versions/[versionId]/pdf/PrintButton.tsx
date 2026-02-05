'use client';

import React from "react";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        border: "1px solid #ccc",
        padding: "6px 10px",
        borderRadius: 6,
        background: "white",
        cursor: "pointer",
      }}
    >
      Print / Save as PDF
    </button>
  );
}
