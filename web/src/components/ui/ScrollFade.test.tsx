import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ScrollFade } from './ScrollFade';

// Mock ResizeObserver as a class
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
});

describe('ScrollFade', () => {
  it('renders children correctly', () => {
    render(
      <ScrollFade>
        <div data-testid="child">Test content</div>
      </ScrollFade>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('applies custom className to wrapper', () => {
    const { container } = render(
      <ScrollFade className="custom-class">
        <div>Content</div>
      </ScrollFade>
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('relative', 'custom-class');
  });

  it('renders gradient overlay element', () => {
    const { container } = render(
      <ScrollFade>
        <div>Content</div>
      </ScrollFade>
    );

    // Find the gradient overlay by its aria-hidden attribute
    const overlay = container.querySelector('[aria-hidden="true"]');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveClass('pointer-events-none', 'absolute', 'bottom-0');
  });

  it('respects custom fadeHeight', () => {
    const { container } = render(
      <ScrollFade fadeHeight={60}>
        <div>Content</div>
      </ScrollFade>
    );

    const overlay = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(overlay).toHaveStyle({ height: '60px' });
  });

  it('gradient does not block pointer events', () => {
    const { container } = render(
      <ScrollFade>
        <div>Content</div>
      </ScrollFade>
    );

    const overlay = container.querySelector('[aria-hidden="true"]');
    expect(overlay).toHaveClass('pointer-events-none');
  });
});
