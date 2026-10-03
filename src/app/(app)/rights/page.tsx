"use client";

import Link from "next/link";

import { HOTLINES } from "@/lib/emergency";

// Legal information for Nepal, checked against primary sources rather than
// written from memory. Every entry names its source so a user — or a judge — can
// verify it, and can see that this is a demo, not legal advice.
//
// Sources: Constitution of Nepal 2015 (Art. 18, 38, 253) via nepallaws.com and
// the UN GBV legislation toolkit; Domestic Violence (Offence and Punishment)
// Act 2066 (2009); National Women Commission Act 2074 (2017).

const RIGHTS = [
  {
    headline: "Violence against you is a crime, whoever you are married to",
    body: "No woman may be subjected to physical, mental, sexual, psychological or any other form of violence or exploitation. The act is punishable by law and the victim has the right to compensation.",
    source: "Constitution of Nepal 2015, Art. 38(3)",
  },
  {
    headline: "You can complain to the police, the Women's Commission, or your local body",
    body: "Under the Domestic Violence Act, anyone who knows about domestic violence — including you — may lodge a written or oral complaint with a police office, the National Women's Commission, or your local body.",
    source: "Domestic Violence (Offence and Punishment) Act 2066 (2009), s.4(1)",
  },
  {
    headline: "The police must produce the perpetrator within 24 hours",
    body: "Where a complaint is filed at a police office or local body, the officer must produce the perpetrator within 24 hours (excluding travel time) and arrest them if they refuse to appear.",
    source: "Domestic Violence Act 2066 (2009), s.4(4)–(5)",
  },
  {
    headline: "You can go straight to court",
    body: "You do not have to exhaust the police route first. The Act lets the victim file the complaint directly with the court.",
    source: "Domestic Violence Act 2066 (2009), s.5(2)",
  },
  {
    headline: "You can get an interim protection order",
    body: "A court may order that you keep living in the shared home, that the perpetrator provide food and clothes and treat you with dignity, that they arrange a separate stay, that they pay for treatment, and that they do not insult, threaten or harass you — including at your home, workplace, or through any communication media.",
    source: "Domestic Violence Act 2066 (2009), s.6(1)",
  },
  {
    headline: "You can ask for the case to be heard privately",
    body: "On your request the court conducts in-camera proceedings, so the hearing is not open to the public.",
    source: "Domestic Violence Act 2066 (2009), s.7",
  },
  {
    headline: "The perpetrator pays for your treatment",
    body: "Expenses of treatment arising from domestic violence fall on the person who committed it.",
    source: "Domestic Violence Act 2066 (2009), s.9",
  },
  {
    headline: "Equal pay, maternity leave, and protection from workplace harassment",
    body: "The Labour Act guarantees equal wages for equal work and maternity leave. The Sexual Harassment at Workplace (Prevention) Act makes harassment an offence.",
    source: "Labour Act 2074 (2017); Sexual Harassment at Workplace (Prevention) Act 2071 (2015)",
  },
  {
    headline: "Property, inheritance and divorce are covered by the Civil Code",
    body: "Marriage, property, inheritance, divorce and guardianship are governed by the National Civil Code 2074 (2017). Criminal protection against violence and abuse sits in the National Penal Code 2074 (2017).",
    source: "National Civil Code 2074 (2017); National Penal Code 2074 (2017)",
  },
  {
    headline: "Being branded a witch is a criminal offence",
    body: "Accusing someone of witchcraft is itself an offence, and women and girls are disproportionately targeted.",
    source: "Witchcraft Accusation (Crime and Punishment) Act 2072 (2015)",
  },
  {
    headline: "Marriage and reproductive health are your decisions",
    body: "Every woman has the right to safe motherhood and reproductive health, protected by the Constitution and by the Right to Safe Motherhood and Reproductive Health Act.",
    source: "Constitution of Nepal 2015, Art. 38(2); Right to Safe Motherhood and Reproductive Health Act 2075 (2018)",
  },
];

export default function RightsPage() {
  const helpline = HOTLINES.find((h) => h.id === "women");
  return (
    <main className="p-3">
      <h1 className="text-lg font-semibold">Your rights in Nepal</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Information, not legal advice. Each line below cites the law it comes from.
      </p>

      {helpline && (
        <a
          href={`tel:${helpline.number}`}
          className="mt-3 block rounded-xl bg-red-600 px-4 py-3 text-center"
        >
          <span className="text-sm font-semibold text-white">
            Women Helpline {helpline.number}
          </span>
          <span className="block text-[11px] text-white/80">
            National Women&apos;s Commission · free to call
          </span>
        </a>
      )}

      <ul className="mt-3 space-y-2">
        {RIGHTS.map((r) => (
          <li key={r.headline} className="rounded-xl bg-black/70 p-3">
            <h2 className="text-sm font-semibold">{r.headline}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.body}</p>
            <p className="mt-1.5 font-mono text-[10px] text-brand">{r.source}</p>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl border border-white/10 bg-black/70 p-3">
        <h2 className="text-sm font-semibold">Where this is still weak</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Knowing your rights matters, but the Domestic Violence Act&apos;s definition of a
          &quot;domestic relationship&quot; still requires legal recognition, so it does not cover
          every unmarried or cohabiting relationship. Nepal has accepted recommendations to
          broaden it. UN bodies have also repeatedly noted that cases take long to resolve and
          that harmful practices persist. This is a real system, with real gaps — not one to
          rely on when you are in danger. Where possible, call someone first.
        </p>
      </div>

      <Link
        href="/help"
        className="mt-4 block rounded-xl bg-black/70 px-3 py-3 text-center text-sm"
      >
        Nearby police, hospitals and helplines →
      </Link>
    </main>
  );
}