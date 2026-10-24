// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Tooltip from './Tooltip';

afterEach(cleanup);

describe('Tooltip', () => {
  it.each([
    ['hover', 'mouseEnter', 'mouseLeave'],
    ['keyboard focus', 'focus', 'blur'],
  ] as const)('shows on %s and links itself to the trigger', (_how, show, hide) => {
    render(<Tooltip label="Cut along the dashed lines"><button>?</button></Tooltip>);
    const trigger = screen.getByRole('button').parentElement!;
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent[show](show === 'focus' ? screen.getByRole('button') : trigger);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Cut along the dashed lines');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);

    fireEvent[hide](hide === 'blur' ? screen.getByRole('button') : trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
  });
});
