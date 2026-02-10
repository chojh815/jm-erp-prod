export const dynamic = "force-dynamic";

export default function OrdersDashboardPdfLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        /* Hide AppShell chrome on the PDF route (both screen & print) */
        header,
        nav,
        aside,
        .app-shell-header,
        .app-shell-sidebar,
        .app-shell-topbar,
        .sidebar,
        .topbar,
        .top-bar,
        .header-bar {
          display: none !important;
        }

        /* Remove any top padding/margin the shell may add */
        main,
        .app-shell-main,
        .app-main,
        .content,
        .container {
          margin-top: 0 !important;
          padding-top: 0 !important;
        }

        /* Print settings */
        @page {
          size: A4 portrait;
          margin: 12mm;
        }
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
      {children}
    </>
  );
}
