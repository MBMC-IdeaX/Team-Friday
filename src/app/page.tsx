import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <svg viewBox="0 0 24 24" className="h-16 w-16" aria-hidden>
        <path
          d="M12 2l8 3.5v6c0 5-3.4 9.3-8 10.5-4.6-1.2-8-5.5-8-10.5v-6L12 2z"
          fill="#1b7a86"
        />
        <path d="M8.5 12l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.8" fill="none" />
      </svg>
      <h1 className="text-4xl font-semibold tracking-tight">HerGuardian</h1>
      <p className="max-w-md text-muted-foreground">
        Stay safe before it happens. Safety scores, safest routes, one-tap SOS.
      </p>
      <Button className="bg-[#1b7a86] text-white hover:bg-[#15636d]">
        Open Safety Map
      </Button>
    </main>
  );
}
