"use client";

import { useEffect, useState } from "react";

import { listGuardians, removeGuardian, saveGuardian, type Guardian } from "@/lib/offline";

// Guardians live on the device, in IndexedDB, not in the database. That is
// deliberate: a phone number is personal data, and keeping it local means a
// leak of our Postgres never exposes the people you chose to trust. It also
// means the SOS text works with no connectivity at all.
//
// A signed-in account does NOT sync these yet — see the honest note below.

export default function GuardiansPage() {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    listGuardians()
      .then((g) => setGuardians(g.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    // strip formatting people paste in, but keep a leading + for country codes
    const clean = phone.replace(/[\s()\-.]/g, "");
    if (!/^\+?\d{6,15}$/.test(clean)) return;
    await saveGuardian({ name: name.trim() || clean, phone: clean });
    setName("");
    setPhone("");
    listGuardians()
      .then((g) => setGuardians(g.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))))
      .catch(() => {});
  };

  const remove = async (id?: number) => {
    if (id == null) return;
    await removeGuardian(id);
    setGuardians((list) => list.filter((g) => g.id !== id));
  };

  const bad = phone.length > 0 && !/^\+?\d{6,15}$/.test(phone.replace(/[\s()\-.]/g, ""));

  return (
    <main className="p-3">
      <h1 className="text-lg font-semibold">Your guardians</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Saved on this phone only. The SOS button calls and texts them straight from the
        device — which is why it still works with no signal.
      </p>

      <form onSubmit={add} className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Sister)"
            className="flex-1 rounded-xl bg-black/70 px-3 py-3 text-sm"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            inputMode="tel"
            className="flex-1 rounded-xl bg-black/70 px-3 py-3 text-sm"
          />
        </div>
        {bad && (
          <p className="text-xs text-red-400">
            That doesn&apos;t look like a phone number. Use digits, and include the country code
            if they are abroad.
          </p>
        )}
        <button
          disabled={bad || !phone.trim()}
          className="w-full rounded-xl bg-red-600 px-3 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Add guardian
        </button>
      </form>

      <ul className="mt-4 space-y-2">
        {guardians.map((g) => (
          <li key={g.id} className="rounded-xl bg-black/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{g.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{g.phone}</p>
              </div>
              <button
                onClick={() => remove(g.id)}
                className="shrink-0 rounded-lg bg-black/70 px-3 py-2 text-xs text-red-400"
              >
                Remove
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <a
                href={`tel:${g.phone}`}
                className="flex-1 rounded-lg bg-red-600/90 px-3 py-2 text-center text-xs font-semibold text-white"
              >
                Call
              </a>
              <a
                href={`sms:${g.phone}`}
                className="flex-1 rounded-lg bg-black/70 px-3 py-2 text-center text-xs"
              >
                Message
              </a>
            </div>
          </li>
        ))}
        {loaded && guardians.length === 0 && (
          <li className="rounded-xl bg-black/70 p-4 text-sm text-muted-foreground">
            No guardians yet. Add someone above and the SOS screen will call them instead of
            the fallback number.
          </li>
        )}
      </ul>

      <p className="mt-4 text-xs text-muted-foreground">
        Signing in does not sync this list yet — guardians are deliberately device-local, and
        syncing them would mean sending someone&apos;s phone number to our database.
      </p>
    </main>
  );
}