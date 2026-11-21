import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BulkImages } from '@/features/products/bulk-images';
import { fakeServices, renderWithProviders } from './helpers';

describe('bulk product photos screen', () => {
  it('refuses a role without catalog.write (cashier)', async () => {
    renderWithProviders(<BulkImages />, { services: fakeServices({ role: 'cashier' }) });
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    expect(screen.queryByText('Choose from gallery')).not.toBeInTheDocument();
  });

  it('lets an owner choose photos, and starts with nothing to upload', async () => {
    renderWithProviders(<BulkImages />, { services: fakeServices({ role: 'owner' }) });
    expect(await screen.findByText('Choose from gallery')).toBeInTheDocument();
    expect(screen.getByText('No photos chosen yet.')).toBeInTheDocument();
  });
});
