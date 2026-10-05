// Small inline SVG icon set (stroke-based, currentColor) so the UI doesn't
// depend on OS/browser emoji fonts for its controls - those render wildly
// differently across platforms and read as clutter rather than icons.
import type { SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function IconChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3.5 6l4.5 4 4.5-4" />
    </Svg>
  );
}

export function IconLayers(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8 2.5l5.5 3L8 8.5l-5.5-3L8 2.5z" />
      <path d="M2.5 8l5.5 3 5.5-3" />
      <path d="M2.5 11l5.5 3 5.5-3" />
    </Svg>
  );
}

export function IconPencil(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M10.5 2.5l3 3L5 14H2v-3l8.5-8.5z" />
      <path d="M9 4l3 3" />
    </Svg>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </Svg>
  );
}

export function IconCopy(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1" />
    </Svg>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5" />
      <path d="M4.5 4.5l.6 8.4a1 1 0 0 0 1 .93h3.8a1 1 0 0 0 1-.93l.6-8.4" />
    </Svg>
  );
}

export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Svg>
  );
}

export function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Svg>
  );
}

export function IconMenu(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </Svg>
  );
}

export function IconChevronLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M10 3.5L6 8l4 4.5" />
    </Svg>
  );
}

export function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 3.5L10 8l-4 4.5" />
    </Svg>
  );
}

export function IconLogout(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6.5 3H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3" />
      <path d="M10 10.5l3-2.5-3-2.5" />
      <path d="M13 8H6" />
    </Svg>
  );
}

export function IconFolder(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M2 4.5a1 1 0 0 1 1-1h2.8l1.4 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7.5z" />
    </Svg>
  );
}

export function IconShare(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12.5" cy="4" r="1.7" />
      <circle cx="3.5" cy="8" r="1.7" />
      <circle cx="12.5" cy="12" r="1.7" />
      <path d="M5 7.1l6-2.2M5 8.9l6 2.2" />
    </Svg>
  );
}

export function IconGripVertical(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="6" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="12" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}
