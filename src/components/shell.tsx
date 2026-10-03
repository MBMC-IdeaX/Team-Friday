"use client";

import { usePathname } from "next/navigation";

import { NavBar, TopBar } from "@/components/nav";

// Every non-emergency screen gets the same chrome, so nothing is a dead end you
// cannot navigate out of. /sos is deliberately full-bleed.
export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/sos") return <>{children}</>;
  const isGuardian = path.startsWith("/guard/");
  return (
    <div className={path === "/" || isGuardian ? "flex h-dvh flex-col" : "flex min-h-full flex-col"}>
      <TopBar />
      <div className={path === "/" || isGuardian ? "flex min-h-0 flex-1 flex-col pb-16" : "flex-1 pb-16"}>{children}</div>
      <NavBar />
    </div>
  );
}
