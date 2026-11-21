import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { PosScreen } from '@/features/pos/pos-screen';
import { CUSTOMERS, HAMMER, fakeServices, renderWithProviders } from './helpers';

const addHammer = async () => userEvent.click(await screen.findByRole('button', { name: 'Add TLS-HAM-16 Claw hammer' }));
const checkoutButton = () => screen.getByRole('button', { name: /Complete sale/ });

describe('POS', () => {
  beforeEach(() => window.localStorage.clear());

  it('adds a product from search and shows VAT-inclusive totals', async () => {
    renderWithProviders(<PosScreen />);
    await addHammer();
    expect(await screen.findByLabelText('Quantity TLS-HAM-16')).toHaveValue('1');
    expect(checkoutButton()).toHaveTextContent(/35\.00/);
  });

  it('records a cash sale: amount applied, cash handed over, and the server receipt', async () => {
    const services = fakeServices();
    renderWithProviders(<PosScreen />, { services });
    await addHammer();
    await userEvent.type(screen.getByLabelText('Cash received'), '40');
    expect((await screen.findAllByText(/5\.00/)).length).toBeGreaterThan(0);

    await userEvent.click(checkoutButton());
    await waitFor(() =>
      expect(services.sales.finalizeSale).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [expect.objectContaining({ productId: HAMMER.id, quantity: '1' })],
          payments: [{ method: 'cash', amount: '35.00', tendered: '40.00', reference: null }],
        }),
      ),
    );
    expect(await screen.findByText('INV-RUH-2026-000001')).toBeInTheDocument();
  });

  it('blocks a balance without a credit customer, and allows it with one', async () => {
    const services = fakeServices();
    renderWithProviders(<PosScreen />, { services });
    await addHammer();
    expect(await screen.findByText(/Select a customer to record a balance on credit/)).toBeInTheDocument();
    expect(checkoutButton()).toBeDisabled();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Customer' }), CUSTOMERS[0]!.id);
    await waitFor(() => expect(checkoutButton()).toBeEnabled());
    await userEvent.click(checkoutButton());
    await waitFor(() =>
      expect(services.sales.finalizeSale).toHaveBeenCalledWith(expect.objectContaining({ customerId: CUSTOMERS[0]!.id, payments: [] })),
    );
  });

  it('a cashier sees no discount or price override controls', async () => {
    renderWithProviders(<PosScreen />, { services: fakeServices({ role: 'cashier' }) });
    await addHammer();
    expect(await screen.findByLabelText('Quantity TLS-HAM-16')).toBeInTheDocument();
    expect(screen.queryByLabelText('Discount type TLS-HAM-16')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Override unit price TLS-HAM-16')).not.toBeInTheDocument();
  });

  it('holds a cart on this device and resumes it', async () => {
    renderWithProviders(<PosScreen />);
    await addHammer();
    await userEvent.click(await screen.findByRole('button', { name: 'Hold' }));
    expect(screen.queryByLabelText('Quantity TLS-HAM-16')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('erp.pos.holds')).toContain('TLS-HAM-16');

    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByLabelText('Quantity TLS-HAM-16')).toHaveValue('1');
    expect(window.localStorage.getItem('erp.pos.holds')).toBe('[]');
  });

  it('a scanner code followed by Enter adds exactly one unit', async () => {
    renderWithProviders(<PosScreen />);
    await screen.findByRole('button', { name: 'Add TLS-HAM-16 Claw hammer' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search products' }), 'TLS-HAM-16{Enter}');
    expect(await screen.findByLabelText('Quantity TLS-HAM-16')).toHaveValue('1');
  });

  describe('offline', () => {
    it('checkout is refused while offline, and the reason is shown', async () => {
      renderWithProviders(<PosScreen />, { connection: 'offline' });
      await addHammer();
      expect(await screen.findByText(/You are offline/)).toBeInTheDocument();
      expect(checkoutButton()).toBeDisabled();
    });
  });
});
