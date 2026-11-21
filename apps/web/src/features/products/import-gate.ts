import type { ImportPlan } from '@erp/domain';

/**
 * Why a product import must not run, or null when it may run. Fails closed: any invalid row, any
 * fatal file problem, or an empty plan blocks the whole import. Partial imports are never allowed,
 * because the rows that would have been saved are not the ones the user reviewed as a whole.
 */
export type ImportBlock = 'no_plan' | 'fatal' | 'invalid' | 'nothing';

export function importBlockReason(plan: ImportPlan | null): ImportBlock | null {
  if (!plan) return 'no_plan';
  if (plan.fatal.length > 0) return 'fatal';
  if (plan.counts.invalid > 0 || plan.products.some((p) => p.action === 'invalid')) return 'invalid';
  if (plan.counts.create + plan.counts.update === 0) return 'nothing';
  return null;
}
