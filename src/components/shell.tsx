"use client";

import { usePathname } from "next/navigation";

import { NavBar, TopBar } from "@/components/nav";

// Every non-emergency screen gets the same chrome, so nothing is a dead end you
// cannot navigate out of. /sos is deliberately full-bleed.
export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/sos") return <>{children}</>;
  return (
    <div className="flex min-h-full flex-col">
      <TopBar />
      <div className="flex-1 pb-16">{children}</div>
      <NavBar />
    </div>
  );
}
