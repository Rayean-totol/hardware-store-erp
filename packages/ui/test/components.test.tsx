import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Alert, Button, Field, Input } from '../src';

describe('Button', () => {
  it('defaults to type=button so it never submits forms by accident', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Button>Click</Button></form>);
    await userEvent.click(screen.getByRole('button', { name: 'Click' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it('can still be a submit button', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Button type="submit">Save</Button></form>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('Field', () => {
  it('wires label, hint and error for assistive technology', () => {
    render(
      <Field label="SKU" hint="Letters and digits" error="Required." required>
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText(/SKU/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Letters and digits Required.');
    expect(screen.getByRole('alert')).toHaveTextContent('Required.');
  });
});

describe('Alert', () => {
  it('announces destructive alerts', () => {
    render(<Alert variant="destructive">Boom</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });
});
