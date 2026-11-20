import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ProductList } from '@/features/products/product-list';
import { ConfigError } from '@/components/config-error';
import { I18nProvider } from '@/providers/i18n-provider';
import { render } from '@testing-library/react';
import { fakeServices, renderWithProviders } from './helpers';

describe('ProductList', () => {
  it('lists products with units and prices', async () => {
    renderWithProviders(<ProductList />);
    expect(await screen.findByText('Claw hammer')).toBeInTheDocument();
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
