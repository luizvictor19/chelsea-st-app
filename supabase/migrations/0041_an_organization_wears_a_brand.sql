-- An organization wears one of the platform's brands (issue #195, ADR 0005).
--
-- Two brands, many organizations: Chelsea St is one organization, and every
-- company is another one wearing GrifoAI. What a brand looks like (name,
-- mascot, colours, host) lives in src/lib/brand.ts; the database only says
-- which one each organization wears, which is what the invite links (#196)
-- and the front door need. src/lib/brand-keys.test.ts holds the list of the
-- check below equal to BRAND_KEYS in that file.
--
-- Measured on 2026-11-06 through the MCP, after 0040: 1 organization,
-- slug chelsea-st, columns id, slug, name and created_at.
--
-- text with a check rather than an enum: a new brand changes the check in one
-- migration, and a new enum value cannot be used in the transaction that adds
-- it.
--
-- No default once the column exists: a new organization names its brand, so
-- a company created in a hurry never turns into Chelsea St by accident. The
-- default below only fills the rows already there.
--
-- No new policy. The column is read under organizations_read (a member reads
-- her own organization's brand) and written under organizations_write (the
-- platform admin alone): an organization's admin does not change its brand.
alter table organizations
  add column brand text not null default 'chelsea-st'
    constraint organizations_brand_known check (brand in ('chelsea-st', 'grifoai'));
alter table organizations alter column brand drop default;

-- GrifoAI's own organization (issue #195, question 2), for the first GrifoAI
-- accounts and for #197. Each company becomes an organization of its own
-- later, one per client.
insert into organizations (slug, name, brand) values ('grifoai', 'GrifoAI', 'grifoai');
