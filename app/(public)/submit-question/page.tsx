import { redirect } from "next/navigation";

import { RoleShell } from "@/components/role-shell";
import { currentUser } from "@/lib/auth/guards";
import { QuestionForm } from "./question-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Submit a question" };

export default async function SubmitQuestionPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/submit-question");
  if (user.role !== "HEI_MEMBER" && user.role !== "INDUSTRY") redirect("/challenges");

  return (
    <RoleShell
      title="Submit a question"
      subtitle="A research question or engineering problem your team is placed to work on — routed and credited the same way as any citizen report."
    >
      <QuestionForm defaultName={user.fullName} />
    </RoleShell>
  );
}
