"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import InstallButton from "@/components/install-button";

import { useUser } from "@/lib/user";

// One nav for every screen, so no page is a dead end you cannot navigate out of.
// Bottom bar because this is a phone-first app held one-handed.

const TABS = [
  { href: "/", label: "Map", icon: "🗺" },
  { href: "/guardians", label: "Guardians", icon: "👥" },
  { href: "/rights", label: "Rights", icon: "⚖️" },
  { href: "/help", label: "Help", icon: "🆘" },
];

export function TopBar() {
  const { user, loading } = useUser();
  return (
    <>
    <header className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
      <Link href="/" className="-my-1 flex shrink-0 items-center gap-2 rounded-lg px-1 py-2">
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <path d="M12 2l8 3.5v6c0 5-3.4 9.3-8 10.5-4.6-1.2-8-5.5-8-10.5v-6L12 2z" fill="#1b7a86" />
          <path d="M8.5 12l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.8" fill="none" />
        </svg>
        <span className="text-sm font-semibold">HerGuardian</span>
      </Link>
      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
        <Link
          href="/dashboard"
          className="rounded-lg px-2 py-2 text-xs text-muted-foreground underline"
        >
          Authority view
        </Link>
        <Link
          href={user ? "/guardians" : "/login"}
          className="max-w-[5rem] truncate rounded-lg bg-black/70 px-2.5 py-2 text-xs sm:max-w-[9rem]"
        >
          {loading ? "…" : user ? user.email : "Sign in"}
        </Link>
      </div>
    </header>
    <InstallButton />
    </>
  );
}

export function NavBar() {
  const path = usePathname();
  // The SOS screen is full-bleed by design; a tab bar there would be noise.
  if (path === "/sos") return null;
  return (
    <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/10 bg-black/85 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {TABS.map((t) => {
        const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] ${
              active ? "text-white" : "text-muted-foreground"
            }`}
          >
            <span className="text-base leading-none" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
