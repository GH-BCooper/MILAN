"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { bugReports } from "@/lib/db/schema";

export async function setBugStatusAction(id: string, status: "OPEN" | "RESOLVED"): Promise<void> {
  await requireRole("ADMIN");
  await db.update(bugReports).set({ status }).where(eq(bugReports.id, id));
  revalidatePath("/admin/bugs");
}
