import type { Metadata } from "next";
import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/auth";
import { BRANDS, isBrandKey, siteOfBrand } from "@/lib/brand";
import { siteConfig } from "@/lib/current-site";
import { adminCount, COMPANY } from "@/lib/organizations";

import { CompanyForm } from "./company-form";

export const metadata: Metadata = {
  title: "Organizações",
};

type Row = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly brand: string;
  readonly hasTeacher: boolean;
  readonly admins: number;
  readonly openAdminInvites: number;
};

/**
 * The platform admin creates a company's organization and invites its first
 * admin (#205), and sees every organization with whether it has an admin.
 * Only she reaches it; organizations_write refuses anyone else's insert anyway.
 */
export default async function OrganizationsPage() {
  const { supabase } = await requirePlatformAdmin();

  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, slug, name, brand, has_teacher, organization_members(role), organization_invites(role, accepted_at, expires_at)",
    )
    .order("name");
  if (error) throw new Error(error.message);

  const now = new Date();
  const rows: Row[] = data.map((organization) => ({
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    brand: isBrandKey(organization.brand)
      ? BRANDS[organization.brand].name
      : organization.brand,
    hasTeacher: organization.has_teacher,
    ...adminCount(
      organization.organization_members,
      organization.organization_invites,
      now,
    ),
  }));

  const company = BRANDS[COMPANY.brand];
  // Until the GrifoAI domain exists (#193), its invite falls back to the
  // Site URL and the template's default brand: say so before the invite goes.
  const config = siteConfig();
  const companyHasNoSite = siteOfBrand(COMPANY.brand, config) === null;
  const fallback = BRANDS["chelsea-st"];
  const fallbackHost = siteOfBrand("chelsea-st", config)?.host;
  const brandNotice =
    `Enquanto o domínio da ${company.name} não estiver no ar, o e-mail do ` +
    `convite diz ${fallback.name} e leva ` +
    (fallbackHost ? `a ${fallbackHost}` : `ao endereço da ${fallback.name}`) +
    `, e a pessoa vê a plataforma com a marca ${fallback.name}.`;

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Organizações
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Nova empresa</h1>
        <p className="text-muted max-w-prose">
          Cria a organização da empresa e convida o primeiro admin dela por
          e-mail. Ela entra, define a senha e convida os funcionários. Uma
          organização criada aqui não se apaga pela tela: confira o nome antes.
        </p>
      </div>

      {companyHasNoSite && (
        <p
          role="note"
          className="border-rule bg-surface text-muted rounded-sm border p-4 text-sm"
        >
          {brandNotice}
        </p>
      )}

      <CompanyForm brandName={company.name} />

      <section aria-labelledby="organizations" className="flex flex-col gap-3">
        <h2 id="organizations" className="text-xl font-bold tracking-tight">
          Organizações
        </h2>
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="font-semibold">{row.name}</span>
                <span className="text-faint font-mono text-xs break-all">
                  {row.slug}
                </span>
              </div>
              <div className="text-muted flex flex-wrap items-baseline gap-x-3 text-sm">
                <span>{row.brand}</span>
                <span>
                  {row.hasTeacher ? "com professor" : "sem professor"}
                </span>
                <AdminCell row={row} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

function AdminCell({ row }: { readonly row: Row }) {
  if (row.admins === 0 && row.openAdminInvites === 0) {
    return (
      <span className="text-accent">
        Sem admin ·{" "}
        <Link href="/teacher/invites" className="underline">
          Convites
        </Link>
      </span>
    );
  }
  const parts = [
    row.admins === 1 ? "1 admin" : `${row.admins} admins`,
    row.openAdminInvites === 1
      ? "1 convite de admin aberto"
      : `${row.openAdminInvites} convites de admin abertos`,
  ];
  return <span>{parts.join(" · ")}</span>;
}
