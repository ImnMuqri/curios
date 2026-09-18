import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchIndexingForm } from './search-indexing.js';

const SWITCH = { name: 'Show my page in search results' };

describe('SearchIndexingForm', () => {
  it('starts a personal page out of search results', () => {
    render(<SearchIndexingForm mode="PERSONAL" allowed={false} onChange={vi.fn()} />);

    expect(screen.getByRole('checkbox', SWITCH)).not.toBeChecked();
  });

  it('sends the owner’s choice, and shows it straight away', async () => {
    const onChange = vi.fn(async () => undefined);
    render(<SearchIndexingForm mode="PERSONAL" allowed={false} onChange={onChange} />);

    await userEvent.click(screen.getByRole('checkbox', SWITCH));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('checkbox', SWITCH)).toBeChecked();
  });

  it('puts the switch back, and says so, when the change could not be saved', async () => {
    const onChange = vi.fn(async () => {
      throw new Error('Something failed on our side. Try again.');
    });
    render(<SearchIndexingForm mode="PERSONAL" allowed={false} onChange={onChange} />);

    await userEvent.click(screen.getByRole('checkbox', SWITCH));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something failed');
    expect(screen.getByRole('checkbox', SWITCH)).not.toBeChecked();
  });

  it('tells a business page it is always in search results, with nothing to switch', () => {
    render(<SearchIndexingForm mode="BUSINESS" allowed={false} onChange={vi.fn()} />);

    expect(screen.getByText('Business pages always appear in search results.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
