import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ProductImport } from '@/features/products/product-import';
import { fakeServices, HAMMER, renderWithProviders, UNITS } from './helpers';
import { vi } from 'vitest';

const HEADER = 'sku,name_en,name_ar,name_bn,description,category,brand,product_type,base_unit,tax_category,tax_exemption_reason,reorder_level,unit,factor,barcode,sale_price,is_sale,is_purchase';
const PCS = UNITS[0]!.code;

function csvFile(rows: string[]): File {
  return new File([[HEADER, ...rows].join('\n')], 'demo.csv', { type: 'text/csv' });
}

async function upload(file: File) {
  const user = userEvent.setup();
  const input = await waitFor(() => {
    const el = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!el) throw new Error('file input not rendered yet');
    return el;
  });
  await user.upload(input, file);
}

describe('product import screen safety', () => {
  it('enables Run for a clean file and says so in the counts', async () => {
    renderWithProviders(<ProductImport />, { services: fakeServices() });
    await upload(csvFile([`DEMO-TEST-A,Demo A (DEMO),تجريبي أ,,,,,stock,${PCS},S,,,${PCS},1,,10,yes,yes`]));
    const run = await screen.findByRole('button', { name: /Import 1 product/ });
    await waitFor(() => expect(run).toBeEnabled());
    expect(screen.queryByText(/Import is blocked/)).not.toBeInTheDocument();
  });

  it('blocks Run and shows the reason when one row of the file is invalid', async () => {
    renderWithProviders(<ProductImport />, { services: fakeServices() });
    await upload(csvFile([
      `DEMO-TEST-OK,Demo OK (DEMO),تجريبي,,,,,stock,${PCS},S,,,${PCS},1,,10,yes,yes`,
      `DEMO-TEST-BAD,Demo bad (DEMO),تجريبي,,,,,stock,${PCS},S,,,no-such-unit,1,,10,yes,yes`,
    ]));
    expect(await screen.findByText(/Import is blocked: 1 row/)).toBeInTheDocument();
    const run = screen.getByRole('button', { name: /Import 1 product/ });
    expect(run).toBeDisabled();
  });
  it('an update of an existing product needs the explicit overwrite confirmation', async () => {
    const services = fakeServices();
    services.catalog.searchProducts = vi.fn(async () => ({
      items: [{ ...HAMMER, sku: 'EXISTING-1', units: [{ ...HAMMER.units[0]!, barcode: null }] }],
      total: 1,
    })) as typeof services.catalog.searchProducts;
    renderWithProviders(<ProductImport />, { services });
    await upload(csvFile([`EXISTING-1,Old name,قديم,,,,,stock,${PCS},S,,,${PCS},1,,10,yes,yes`]));
    const run = await screen.findByRole('button', { name: /Import 1 product/ });
    expect(run).toBeDisabled();
    expect(await screen.findByText(/Import is blocked until you confirm/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(run).toBeEnabled());
  });
});
