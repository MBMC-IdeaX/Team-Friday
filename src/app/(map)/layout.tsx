// Full-bleed map screens: / and /guard/[id]
//
// h-dvh + min-h-0 is load-bearing, not cosmetic: on a phone the layout
// viewport is TALLER than the visible one while the URL bar is showing, so a
// min-h-full map grows past the fold and its absolutely-positioned SOS button
// (bottom-3) ends up off-screen. dvh tracks the real visible height.
import { NavBar, TopBar } from "@/components/nav";

export default function MapChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1 flex-col pb-16">{children}</div>
      <NavBar />
    </div>
  );
}
