import { currentSite } from "@/lib/current-site";

/** The brand name above a screen's heading. Nothing on an unknown host. */
export async function BrandMark() {
  const site = await currentSite();
  if (!site) {
    return null;
  }

  return (
    <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
      {site.brand.name}
    </p>
  );
}
