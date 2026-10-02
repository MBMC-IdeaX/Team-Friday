"use client";

// App Router error boundary. Without this a thrown error unmounts the segment
// and the phone shows a blank page with no explanation — which is exactly how
// the insecure-origin crash hid.

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="text-lg font-semibold text-red-400">Something broke</h1>
      <pre className="max-w-full overflow-auto rounded-xl bg-black/70 p-3 text-left text-xs text-muted-foreground">
        {error.message}
      </pre>
      <button onClick={reset} className="rounded-xl bg-black/70 px-4 py-3 text-sm">
        Try again
      </button>
    </main>
  );
}