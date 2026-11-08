/** Demo presentation assets, independent of credentials, state and SDK packages. */
const paths = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  account:
    'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M8 7h3 M8 10h2 M8 16h8 M8 18h5 M16 8v4 M14 10h4',
  wallet: 'M20 8V5H6a3 3 0 0 0 0 6h15v9H6a3 3 0 0 1-3-3V8 M21 13h-5v4h5 M18 15h.01',
  audit:
    'M8 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M3 7h5 M3 12h5 M3 17h5 M12 8h4 M12 12h4 M12 16h3',
  settings:
    'M3 6h3 M10 6h11 M3 12h11 M18 12h3 M3 18h3 M10 18h11 M6 4h4v4H6z M14 10h4v4h-4z M6 16h4v4H6z',
  signup: 'M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M3 21v-2a7 7 0 0 1 10-6 M18 13v8 M14 17h8',
  passkey:
    'M4 11a8 8 0 0 1 16 0 M7 12v-1a5 5 0 0 1 10 0v3 M10 13v-2a2 2 0 0 1 4 0v4a9 9 0 0 1-2 6 M4 15a14 14 0 0 1-1 5 M7 16a15 15 0 0 1-1 5 M10 17a14 14 0 0 1-1 4 M17 18a12 12 0 0 1-1 3 M20 15v2',
} as const;

export type DemoIcon = keyof typeof paths;

/** Decorative only: the adjacent visible control label supplies its accessible name. */
export function createIcon(name: DemoIcon): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('passport-icon');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}
