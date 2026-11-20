import { DataError } from '@erp/data';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProductForm, type ProductFormProps } from '@/features/products/product-form';
import { BRANDS, CATEGORIES, HAMMER, ORG, renderWithProviders, UNITS } from './helpers';

function setup(props: Partial<ProductFormProps> = {}, locale: 'en' | 'ar' | 'bn' = 'en') {
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
    { locale },
  );
  return { onSave, user: userEvent.setup() };
}

describe('ProductForm', () => {
  it('creates a multi-unit product with a normalised draft', async () => {
    const { onSave, user } = setup();
    await user.type(await screen.findByLabelText(/^SKU/), 'ws 4x40');
    await user.type(screen.getByLabelText(/Name \(English\)/), 'Wood screw');
    await user.type(screen.getByLabelText(/Name \(Arabic\)/), 'برغي خشب');
    const baseRow = screen.getByTestId('unit-row-0');
    await user.type(within(baseRow).getByLabelText(/Sale price/), '0.15');

    await user.click(screen.getByRole('button', { name: 'Add unit' }));
    const row = screen.getByTestId('unit-row-1');
    // first unused count unit is "Box": packaging unit, so no factor is suggested
    expect(within(row).getByLabelText('Unit')).toHaveValue(UNITS[1]!.id);
    await user.type(within(row).getByLabelText('Base units per unit'), '200');
    expect(within(row).getByText('1 Box = 200 Piece')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const [draft, expectedVersion] = onSave.mock.calls[0]!;
    expect(expectedVersion).toBeNull();
    expect(draft.sku).toBe('WS-4X40');
    expect(draft.units).toEqual([
      expect.objectContaining({ unitId: UNITS[0]!.id, factor: '1', isBase: true, salePrice: '0.15', barcode: null }),
      expect.objectContaining({ unitId: UNITS[1]!.id, factor: '200', isBase: false, salePrice: null }),
    ]);
  });

  it('suggests standard factors (dozen = 12 pieces)', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add unit' }));
    const row = screen.getByTestId('unit-row-1');
    await user.selectOptions(within(row).getByLabelText('Unit'), UNITS[2]!.id);
    expect(within(row).getByLabelText('Base units per unit')).toHaveValue('12');
  });

  it('shows field errors and does not save invalid drafts', async () => {
    const { onSave, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add unit' }));
    await user.type(within(screen.getByTestId('unit-row-1')).getByLabelText('Base units per unit'), '12.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Please fix the highlighted fields.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^SKU/)).toHaveAttribute('aria-invalid', 'true');
    expect(within(screen.getByTestId('unit-row-1')).getByText(/must be a whole number/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects a mistyped GTIN barcode', async () => {
    const { onSave, user } = setup({ product: HAMMER });
    const barcode = within(await screen.findByTestId('unit-row-0')).getByLabelText(/Barcode/);
    await user.clear(barcode);
    await user.type(barcode, '2000000100105');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Check digit is wrong/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('edits an existing product with optimistic version and clean decimals', async () => {
    const { onSave, user } = setup({ product: HAMMER });
    const row = await screen.findByTestId('unit-row-1');
    expect(within(row).getByLabelText('Base units per unit')).toHaveValue('12');
    expect(within(row).getByLabelText(/Sale price/)).toHaveValue('390');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![1]).toBe(3);
    expect(onSave.mock.calls[0]![0].id).toBe(HAMMER.id);
  });

  it('shows a VAT breakdown for VAT-inclusive prices', async () => {
    setup({ product: HAMMER });
    const row = await screen.findByTestId('unit-row-0');
    expect(within(row).getByText(/Net SAR\s?30\.43 · VAT SAR\s?4\.57 · Total SAR\s?35\.00/)).toBeInTheDocument();
  });

  it('locks prices for users without catalog.price_write', async () => {
    setup({ product: HAMMER, canEditPrices: false });
    const row = await screen.findByTestId('unit-row-0');
    expect(within(row).getByLabelText(/Sale price/)).toBeDisabled();
    expect(screen.getByText(/You do not have permission to change prices/)).toBeInTheDocument();
  });

  it('requires an exemption reason for zero-rated products', async () => {
    const { user } = setup({ product: HAMMER });
    await user.selectOptions(await screen.findByLabelText('VAT category'), 'Z');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText(/Exemption/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('surfaces concurrency conflicts with a reload action', async () => {
    const onReload = vi.fn();
    const onSave = vi.fn(async () => {
      throw new DataError('concurrency_conflict', 'concurrency_conflict', '4');
    });
    const { user } = setup({ product: HAMMER, onSave, onReload });
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Someone else changed this product/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('translates known server errors and shows unknown ones verbatim', async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new DataError('product.sku_taken', 'product.sku_taken', 'TLS-HAM-16'))
      .mockRejectedValueOnce(new Error('socket hang up'));
    const { user } = setup({ product: HAMMER, onSave });
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('SKU TLS-HAM-16 is already used by another product.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Unexpected error: socket hang up')).toBeInTheDocument();
  });

  it('renders right-to-left in Arabic', async () => {
    setup({ product: HAMMER }, 'ar');
    expect(await screen.findByRole('button', { name: 'حفظ' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(screen.getByLabelText(/الاسم \(بالعربية\)/)).toHaveValue('مطرقة مخلب');
  });

  it('renders in Bangla with Bengali digits in previews', async () => {
    setup({ product: HAMMER }, 'bn');
    expect(await screen.findByRole('button', { name: 'সংরক্ষণ' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.getByText(/১ বাক্স = ১২ পিস|১ Box = ১২ Piece/)).toBeInTheDocument();
  });
});
