import type { DbClient } from './client';
import { toDataError, unwrap } from './errors';
import type { Member, MembershipContext } from './models';

interface RawContext {
  user_id: string | null;
  memberships: Array<{
    membership_id: string;
    org_id: string;
    org_name_en: string;
    org_name_ar: string;
    prices_include_vat: boolean;
    role: string;
    all_branches: boolean;
    permissions: string[];
    branches: Array<{ id: string; code: string; name_en: string; name_ar: string }>;
  }>;
}

export interface CreateOrganizationInput {
  legalNameEn: string;
  legalNameAr: string;
  vatNumber: string | null;
  crNumber: string | null;
  branchCode: string;
  branchNameEn: string;
  branchNameAr: string;
  defaultLocale: 'en' | 'ar' | 'bn';
}

export interface OrgRepository {
  getMyContext(): Promise<MembershipContext[]>;
  createOrganization(input: CreateOrganizationInput): Promise<string>;
  listMembers(orgId: string): Promise<Member[]>;
  addMemberByEmail(orgId: string, email: string, roleCode: string): Promise<string>;
}

export function createSupabaseOrgRepository(db: DbClient): OrgRepository {
  return {
    async getMyContext() {
      const ctx = unwrap(await db.rpc('get_my_context')) as RawContext;
      return ctx.memberships.map((m) => ({
        membershipId: m.membership_id,
        orgId: m.org_id,
        orgNameEn: m.org_name_en,
        orgNameAr: m.org_name_ar,
        pricesIncludeVat: m.prices_include_vat,
        role: m.role,
        allBranches: m.all_branches,
        permissions: m.permissions,
        branches: m.branches.map((b) => ({ id: b.id, code: b.code, nameEn: b.name_en, nameAr: b.name_ar })),
      }));
    },

    async createOrganization(input) {
      return unwrap(
        await db.rpc('create_organization', {
          p_legal_name_en: input.legalNameEn,
          p_legal_name_ar: input.legalNameAr,
          p_branch_code: input.branchCode,
          p_branch_name_en: input.branchNameEn,
          p_branch_name_ar: input.branchNameAr,
          p_vat_number: input.vatNumber,
          p_cr_number: input.crNumber,
          p_default_locale: input.defaultLocale,
        }),
      ) as string;
    },

    async listMembers(orgId) {
      const result = await db.rpc('list_members', { p_org_id: orgId });
      if (result.error) throw toDataError(result.error);
      return ((result.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        membershipId: r.membership_id as string,
        userId: r.user_id as string,
        email: r.email as string,
        fullName: (r.full_name as string | null) ?? null,
        role: r.role as string,
        allBranches: r.all_branches as boolean,
        isActive: r.is_active as boolean,
      }));
    },

    async addMemberByEmail(orgId, email, roleCode) {
      return unwrap(
        await db.rpc('add_member_by_email', { p_org_id: orgId, p_email: email, p_role_code: roleCode }),
      ) as string;
    },
  };
}
