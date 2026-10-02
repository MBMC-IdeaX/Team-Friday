import GuardTracker from "@/components/guard-tracker";

// The uuid in the path IS the capability — no login, matching schema.sql.
export default async function GuardPage({ params }: PageProps<"/guard/[id]">) {
  const { id } = await params;
  return <GuardTracker id={id} />;
}