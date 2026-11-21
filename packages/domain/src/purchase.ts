/**
 * Purchase order rules for the screens. The database enforces every rule (create_purchase_order,
 * submit/approve/cancel, update_purchase_order). These functions only decide which buttons to show.
 */

export type PurchaseStatus = 'draft' | 'submitted' | 'approved' | 'partially_received' | 'fully_received' | 'cancelled';
export type PurchaseAction = 'edit' | 'submit' | 'approve' | 'cancel';

export interface PurchaseActor {
  permissions: readonly string[];
  /** True when the signed-in user created the order. */
  isCreator: boolean;
}

/** The actions the user may see on an order. The server still decides; this only hides what cannot work. */
export function purchaseActions(status: PurchaseStatus, actor: PurchaseActor): PurchaseAction[] {
  const has = (p: string) => actor.permissions.includes(p);
  const actions: PurchaseAction[] = [];
  if (status === 'draft') {
    // Editing is allowed to the creator, and to approvers as a fallback.
    if (has('purchase.create') && (actor.isCreator || has('purchase.approve'))) actions.push('edit');
    if (has('purchase.create')) actions.push('submit');
  }
  if (status === 'submitted' && has('purchase.approve') && !actor.isCreator) actions.push('approve');
  if ((status === 'draft' || status === 'submitted' || status === 'approved') && has('purchase.void')) actions.push('cancel');
  return actions;
}

/** Whether a line quantity typed by the user is a valid purchase quantity (positive, at most six decimals). */
export function validPurchaseQuantity(text: string): boolean {
  return /^[0-9]{1,12}(\.[0-9]{1,6})?$/.test(text.trim()) && Number(text) > 0;
}

/** Whether a unit cost is valid (zero or more, at most four decimals). */
export function validUnitCost(text: string): boolean {
  return /^[0-9]{1,12}(\.[0-9]{1,4})?$/.test(text.trim());
}
