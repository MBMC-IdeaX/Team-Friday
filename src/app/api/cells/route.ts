import { NextResponse } from "next/server";
import { getCells } from "@/lib/db";

export async function GET() {
  const { cells, source } = await getCells();
  return NextResponse.json({ cells, source });
}
