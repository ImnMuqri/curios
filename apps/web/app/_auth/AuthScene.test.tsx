import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AuthScene } from './AuthScene.js';

describe('AuthScene', () => {
  it('sign in shows Peek with a phone, three cards and "While you were away"', () => {
    const { container } = render(<AuthScene scene="signin" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-peek-phone]')).not.toBeNull();
    expect(container).toHaveTextContent('Boleh hantar ke Klang?');
    expect(container).toHaveTextContent('Ada kek tanpa telur?');
    expect(container).toHaveTextContent('Nak order 2kg untuk Sabtu');
    expect(container).toHaveTextContent('Number saved');
    expect(container).toHaveTextContent('While you were away');
    expect(container).toHaveTextContent('Your page answered 12 questions and saved 2 numbers.');
  });

  it('sign up shows the handle on Peek\'s sign with a tick and the reworded caption', () => {
    const { container } = render(<AuthScene scene="signup" handle="aisyahdraws" />);
    expect(container.querySelector('svg')).toHaveTextContent('curios.my/aisyahdraws');
    expect(container.querySelector('[data-peek-tick]')).not.toBeNull();
    expect(container).toHaveTextContent('We’ll save this name for you');
    expect(container).toHaveTextContent('Finish signing up to claim curios.my/aisyahdraws.');
    expect(container).not.toHaveTextContent('holding your name');
  });

  it('without a handle, the sign reads curios.my/yourname with no tick', () => {
    const { container } = render(<AuthScene scene="signup" />);
    expect(container.querySelector('svg')).toHaveTextContent('curios.my/yourname');
    expect(container.querySelector('[data-peek-tick]')).toBeNull();
    expect(container).toHaveTextContent('Finish signing up to claim curios.my/yourname.');
  });

  it('keeps its SVG ids apart when two scenes share a page', () => {
    const { container } = render(
      <>
        <AuthScene scene="signin" />
        <AuthScene scene="signup" />
      </>,
    );
    const ids = [...container.querySelectorAll('clipPath')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(2);
  });

  it('squeezes a 30-character handle to fit the sign', () => {
    const long = 'a'.repeat(30);
    const { container } = render(<AuthScene scene="signup" handle={long} />);
    const name = [...container.querySelectorAll('text')].find((node) => node.textContent === long);
    expect(name).toHaveAttribute('textLength', '100');
    expect(name).toHaveAttribute('lengthAdjust', 'spacingAndGlyphs');
  });

  it('leaves a short handle at its natural width', () => {
    const { container } = render(<AuthScene scene="signup" handle="aisyahdraws" />);
    const name = [...container.querySelectorAll('text')].find((node) => node.textContent === 'aisyahdraws');
    expect(name).not.toHaveAttribute('textLength');
  });
});
