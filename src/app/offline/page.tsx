export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
        <h1 className="text-2xl font-semibold text-slate-900">
          You are offline
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          JM ERP needs an internet connection for live business data. Reconnect
          and reopen the page to continue.
        </p>
      </div>
    </div>
  );
}
