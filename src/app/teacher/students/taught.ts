/**
 * The rows of students someone teaches: those of an organization with a
 * teacher. An employee of a company is a row of students too, of an
 * organization without one (0042), and the platform admin reads every row,
 * so without this the agenda of the students listed employees (#362).
 */
export function taught<
  T extends { readonly organizations: { readonly has_teacher: boolean } },
>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.organizations.has_teacher);
}
