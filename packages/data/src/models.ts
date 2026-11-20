import type { ProductDraft, ProductUnitDef, UnitDef } from '@erp/domain';

export interface Unit extends UnitDef {
  orgId: string | null;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  isActive: boolean;
}

export interface Category {
  id: string;
  orgId: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string;
  nameBn: string | null;
  sortOrder: number;
  isActive: boolean;
  rowVersion: number;
}

export interface Brand {
  id: string;
  orgId: string;
  name: string;
  isActive: boolean;
  rowVersion: number;
}

export interface ProductUnit extends ProductUnitDef {
  id: string;
}

export interface Product extends Omit<ProductDraft, 'units' | 'id'> {
  id: string;
  archivedAt: string | null;
  imagePath: string | null;
  updatedAt: string;
  rowVersion: number;
  units: ProductUnit[];
}

export interface ProductQuery {
  orgId: string;
  search?: string;
  categoryId?: string | null;
  brandId?: string | null;
  includeArchived?: boolean;
  limit: number;
  offset: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface MembershipContext {
  membershipId: string;
  orgId: string;
  orgNameEn: string;
  orgNameAr: string;
  pricesIncludeVat: boolean;
  role: string;
  allBranches: boolean;
  permissions: string[];
  branches: Array<{ id: string; code: string; nameEn: string; nameAr: string }>;
}

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string | null;
  role: string;
  allBranches: boolean;
  isActive: boolean;
}
