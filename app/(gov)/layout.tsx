import { SiteHeader } from "@/components/site-header";

export default function GroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
