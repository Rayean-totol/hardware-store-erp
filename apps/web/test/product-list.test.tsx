import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProductList } from '@/features/products/product-list';
import { ConfigError } from '@/components/config-error';
import { I18nProvider } from '@/providers/i18n-provider';
import { render } from '@testing-library/react';
import { HAMMER, fakeServices, renderWithProviders } from './helpers';

/** The grid (default) has Edit only; archive and unit badges live in the list view. */
async function showList() {
  await userEvent.click(screen.getByRole('button', { name: 'List view' }));
}

describe('ProductList', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the premium grid by default with SKU, price, placeholder and edit link', async () => {
    renderWithProviders(<ProductList />);
    expect(await screen.findByText('Claw hammer')).toBeInTheDocument();
    expect(screen.getByText('TLS-HAM-16')).toBeInTheDocument();
    expect(screen.getByText(/SAR\s?35\.00/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'No image' })).toBeInTheDocument();
    const edit = screen.getByRole('link', { name: 'Edit TLS-HAM-16' });
    expect(edit.getAttribute('href')).toMatch(/^\/products\/edit\/?\?id=/);
    expect(edit.getAttribute('href')).toContain(HAMMER.id);
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the stored product image through a signed link', async () => {
    const { container } = renderWithProviders(<ProductList />, {
      services: fakeServices({ products: [{ ...HAMMER, imagePath: 'org/product/hammer.jpg' }] }),
    });
    await screen.findByText('Claw hammer');
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.test/x.jpg'));
    expect(screen.queryByRole('img', { name: 'No image' })).not.toBeInTheDocument();
  });

  it('remembers the chosen view on this device', async () => {
    const first = renderWithProviders(<ProductList />);
    await screen.findByText('Claw hammer');
    await showList();
    expect(window.localStorage.getItem('erp.products.view')).toBe('list');
    first.unmount();

    renderWithProviders(<ProductList />);
    expect(await screen.findByText('Box × 12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lists products with units and prices', async () => {
    renderWithProviders(<ProductList />);
    expect(await screen.findByText('Claw hammer')).toBeInTheDocument();
    await showList();
    expect(screen.getByText('TLS-HAM-16')).toBeInTheDocument();
    expect(screen.getByText('Box × 12')).toBeInTheDocument();
    expect(screen.getByText(/SAR\s?35\.00/)).toBeInTheDocument();
    expect(screen.getByText('1 products')).toBeInTheDocument();
  });

  it('searches through the repository (debounced)', async () => {
    const services = fakeServices();
    renderWithProviders(<ProductList />, { services });
    await screen.findByText('Claw hammer');
    await userEvent.type(screen.getByRole('searchbox'), 'drill');
    await waitFor(() =>
      expect(services.catalog.searchProducts).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'drill', offset: 0 })),
    );
    expect(await screen.findByText('No products match your search.')).toBeInTheDocument();
  });

  it('owners see create and archive actions; cashiers do not', async () => {
    const { unmount } = renderWithProviders(<ProductList />);
    await screen.findByText('Claw hammer');
    await showList();
    expect(await screen.findByRole('button', { name: 'Archive TLS-HAM-16' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New product/ })).toBeInTheDocument();
    unmount();

    renderWithProviders(<ProductList />, { services: fakeServices({ role: 'cashier' }) });
    await screen.findByText('Claw hammer');
    expect(screen.queryByRole('link', { name: /New product/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archive/ })).not.toBeInTheDocument();
  });

  it('archives after confirmation', async () => {
    const services = fakeServices();
    renderWithProviders(<ProductList />, { services });
    await screen.findByText('Claw hammer');
    await showList();
    await userEvent.click(await screen.findByRole('button', { name: 'Archive TLS-HAM-16' }));
    expect(screen.getByText(/Archive “Claw hammer”\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(services.catalog.setProductArchived).toHaveBeenCalledWith(expect.any(String), true));
  });

  it('shows repository errors instead of an empty list', async () => {
    const services = fakeServices();
    services.catalog.searchProducts = async () => {
      throw new TypeError('Failed to fetch');
    };
    renderWithProviders(<ProductList />, { services });
    expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument();
  });
});

describe('ConfigError', () => {
  it('lists missing settings', async () => {
    render(
      <I18nProvider locale="en">
        <ConfigError missing={['NEXT_PUBLIC_SUPABASE_URL']} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Configuration required')).toBeInTheDocument();
    expect(screen.getByText('NEXT_PUBLIC_SUPABASE_URL')).toBeInTheDocument();
  });
});
