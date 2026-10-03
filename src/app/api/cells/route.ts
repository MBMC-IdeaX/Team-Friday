import { NextResponse } from "next/server";
import { getCells } from "@/lib/db";

export async function GET() {
  const { cells, source } = await getCells(AbortSignal.timeout(5_000));
  return NextResponse.json({ cells, source });
}
