import { SiteHeader } from "@/components/site-header";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="relative mx-auto w-full max-w-md px-4 py-10 sm:px-6">
        {/* the halo behind the sign-in panel — decorative only */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-10 -z-10 mx-auto h-56 w-[28rem] max-w-[110vw] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(124,92,255,0.35),transparent_65%)] blur-2xl"
        />
        <div className="milan-glass milan-rise rounded-2xl p-6 sm:p-8">{children}</div>
      </main>
    </>
  );
}
