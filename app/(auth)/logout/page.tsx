import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Sign out" };

/**
 * Signing out is a state change, so it is a POST through a server action rather
 * than a link that a prefetcher could fire on hover.
 */
export default function LogoutPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Sign out</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your reports stay on the platform and keep their tracking IDs.
      </p>
      <form action={logoutAction} className="mt-6">
        <Button type="submit" className="w-full">
          Sign out
        </Button>
      </form>
    </div>
  );
}
