"use client";

import * as React from "react";

export default function AutoPrintClient({ title }: { title?: string }) {
  React.useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  return (
    <>
      <style>{`
        .ws-toolbar {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin: 10px 0 8px;
        }

        .ws-btn {
          padding: 6px 16px;
          font-size: 13px;
          font-weight: 600;
          border-radius: 4px;
          border: 1px solid transparent;
          cursor: pointer;
          transition: background-color .15s ease, box-shadow .15s ease, transform .05s ease;
        }

        .ws-btn:active {
          transform: translateY(1px);
        }

        /* Print = Primary */
        .ws-btn-print {
          background: #2563eb;       /* blue-600 */
          color: #fff;
          border-color: #2563eb;
        }
        .ws-btn-print:hover {
          background: #1e40af;       /* blue-800 */
          box-shadow: 0 2px 6px rgba(37,99,235,.25);
        }

        /* Close = Neutral */
        .ws-btn-close {
          background: #f3f4f6;       /* gray-100 */
          color: #111827;            /* gray-900 */
          border-color: #d1d5db;     /* gray-300 */
        }
        .ws-btn-close:hover {
          background: #e5e7eb;       /* gray-200 */
          box-shadow: 0 2px 6px rgba(0,0,0,.08);
        }

        /* 🔒 인쇄/PDF에는 버튼 숨김 */
        @media print {
          .ws-toolbar { display: none !important; }
        }
      `}</style>

      <div className="ws-toolbar">
        <button
          type="button"
          className="ws-btn ws-btn-print"
          onClick={() => window.print()}
        >
          Print
        </button>
        <button
          type="button"
          className="ws-btn ws-btn-close"
          onClick={() => window.close()}
        >
          Close
        </button>
      </div>
    </>
  );
}
