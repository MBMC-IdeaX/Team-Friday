// Scrolling screens: /rights /help /guardians /login /dashboard
//
// ponytail: the chrome is chosen by ROUTE GROUP, not by reading usePathname()
// during render. A render-time route branch makes the server and client emit
// different markup whenever the two disagree, which React reports as a
// hydration mismatch and cannot patch. A group layout is fixed per route, so
// first paint is identical on both sides by construction.
import { NavBar, TopBar } from "@/components/nav";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden">
      <TopBar />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(4rem_+_env(safe-area-inset-bottom))]">{children}</div>
      <NavBar />
    </div>
  );
}
