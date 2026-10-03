// /sos is deliberately full-bleed: no top bar, no tab bar. A panic screen
// with navigation on it is a panic screen you can mis-tap.
export default function Bare({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
