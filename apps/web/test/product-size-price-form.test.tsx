import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProductForm, type ProductFormProps } from '@/features/products/product-form';
import { BRANDS, CATEGORIES, HAMMER, ORG, renderWithProviders, UNITS } from './helpers';

function setup(props: Partial<ProductFormProps> = {}) {
  const onSave = vi.fn<ProductFormProps['onSave']>(async () => undefined);
  renderWithProviders(
    <ProductForm
      orgId={ORG}
      product={null}
      units={UNITS}
      categories={CATEGORIES}
      brands={BRANDS}
      pricesIncludeVat
      canEditPrices
      onSave={onSave}
      onCancel={vi.fn()}
      {...props}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/^SKU/), 'SIZE-TEST');
  await user.type(screen.getByLabelText(/Name \(English\)/), 'Size test');
  await user.type(screen.getByLabelText(/Name \(Arabic\)/), 'اختبار');
}

describe('ProductForm: size and purchase price', () => {
  it('a user who may change prices enters a size and a purchase price, and both are saved', async () => {
    const { onSave, user } = setup();
    await fillRequired(user);
    await user.type(screen.getByLabelText(/^Size/), '50 kg');
    const baseRow = screen.getByTestId('unit-row-0');
    await user.type(within(baseRow).getByLabelText(/Sale price/), '12');
    await user.type(within(baseRow).getByLabelText(/Purchase price/), '7.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const draft = onSave.mock.calls[0]![0];
    expect(draft.sizeLabel).toBe('50 kg');
    expect(draft.units[0]!.purchasePrice).toBe('7.5');
    expect(draft.units[0]!.salePrice).toBe('12');
  });

  it('a user who may not change prices sees no purchase price field, and the save never carries one', async () => {
    const { onSave, user } = setup({ canEditPrices: false });
    await fillRequired(user);
    const baseRow = screen.getByTestId('unit-row-0');
    expect(within(baseRow).queryByLabelText(/Purchase price/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // Undefined, not null: the save code omits undefined, so the stored cost is untouched.
    expect(onSave.mock.calls[0]![0].units[0]!.purchasePrice).toBeUndefined();
  });

  it('shows a stored purchase price, and saving unchanged keeps it (no accidental clear)', async () => {
    const { onSave, user } = setup({ product: HAMMER, canEditPrices: true, unitCosts: { [UNITS[0]!.id]: '3.5' } });
    const baseRow = await screen.findByTestId('unit-row-0');
    expect(within(baseRow).getByLabelText(/Purchase price/)).toHaveValue('3.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].units[0]!.purchasePrice).toBe('3.5');
  });

  it('a purchase price above the selling price is a warning and does not block saving', async () => {
    const { onSave, user } = setup();
    await fillRequired(user);
    const baseRow = screen.getByTestId('unit-row-0');
    await user.type(within(baseRow).getByLabelText(/Sale price/), '5');
    await user.type(within(baseRow).getByLabelText(/Purchase price/), '9');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((await screen.findAllByText(/above the selling price/i)).length).toBeGreaterThan(0);
  });

  it('a variant group typed on the form is saved with the product', async () => {
    const { onSave, user } = setup();
    await fillRequired(user);
    await user.type(screen.getByLabelText(/Variant group/), 'PVC-PIPE');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].variantGroup).toBe('PVC-PIPE');
  });
});
