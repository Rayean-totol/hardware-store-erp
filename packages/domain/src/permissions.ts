/**
 * Permission catalogue and system role matrix.
 * MUST match supabase/migrations/*_rbac.sql — tests/db/rbac.test.ts compares them.
 * The UI uses this only to hide actions; the database (RLS + RPC checks) enforces it.
 */
export const PERMISSIONS = [
  'org.manage',
  'branch.manage',
  'users.manage',
  'audit.read',
  'catalog.read',
  'catalog.write',
  'catalog.price_write',
  'catalog.archive',
  'warehouse.manage',
  'inventory.read',
  'inventory.move',
  'inventory.adjust',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = [
  'owner',
  'admin',
  'manager',
  'storekeeper',
  'cashier',
  'accountant',
  'auditor',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  owner: ALL,
  admin: ALL,
  manager: [
    'audit.read', 'catalog.read', 'catalog.write', 'catalog.price_write', 'catalog.archive',
    'inventory.read', 'inventory.move', 'inventory.adjust',
  ],
  storekeeper: ['catalog.read', 'catalog.write', 'inventory.read', 'inventory.move'],
  cashier: ['catalog.read', 'inventory.read'],
  accountant: ['catalog.read', 'audit.read', 'inventory.read'],
  auditor: ['catalog.read', 'audit.read', 'inventory.read'],
};

export function hasPermission(granted: readonly string[], permission: Permission): boolean {
  return granted.includes(permission);
}
