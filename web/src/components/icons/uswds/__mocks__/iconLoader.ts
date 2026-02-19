// Mock SVG component for testing
import { createElement } from 'react';

export const MockSvgComponent = ({
  className,
  children,
  ...props
}: React.SVGProps<SVGSVGElement>) => {
  return createElement(
    'svg',
    { className, 'data-testid': 'mock-icon', ...props },
    createElement('path', { d: 'M0 0h24v24H0z' }),
    children
  );
};

export default MockSvgComponent;
