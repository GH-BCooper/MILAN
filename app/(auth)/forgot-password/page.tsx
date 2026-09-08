import Link from "next/link";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A code goes to your verified email and/or phone. You must enter it correctly before you can set a new
        password — nobody can reset your account without access to one of those.
      </p>

      <div className="mt-6">
        <ForgotPasswordForm />
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link className="font-medium text-primary underline underline-offset-4" href="/login">
          Sign in
        </Link>
      </p>
    </div>
  );
}
