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
    <div className="flex min-h-full flex-col">
      <TopBar />
      <div className="flex-1 pb-16">{children}</div>
      <NavBar />
    </div>
  );
}
