const PATHS: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm9 0h7v-9h-7v9Zm0-16v5h7V4h-7Z',
  live: 'M3 12h3l2-6 4 12 3-8 2 2h4',
  codes: 'M12 9v4m0 4h.01M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  repair: 'm14.7 6.3a4 4 0 0 0 5 5L21 21H3l1.3-9.7a4 4 0 0 0 5-5l2.7 2.7 2.7-2.7Z',
  vehicle: 'M5 17h14M6 17V9l2-4h8l2 4v8M6 17v2h2v-2m8 0v2h2v-2M8 9h8',
  tools: 'M14.7 6.3a4 4 0 1 0 5 5L9 22H2v-7L14.7 6.3Z',
  bluetooth: 'm7 7 10 10-5 4V3l5 4L7 17',
  wifi: 'M5 12.6a10 10 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01',
  play: 'M6 4l14 8-14 8V4Z',
  pause: 'M8 4h3v16H8V4Zm5 0h3v16h-3V4Z',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M20 6 9 17l-5-5',
  chevron: 'm9 18 6-6-6-6',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 21h16',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.3-4.3',
  gauge: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0-10a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm4 4-2.5 2.5',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14h.01M11 12h1v5h1',
  shock: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8v-7Z',
  plus: 'M12 5v14M5 12h14',
  wrench: 'm14.7 6.3a4 4 0 0 0 5 5L21 21H3l1.3-9.7a4 4 0 0 0 5-5l2.7 2.7 2.7-2.7Z',
  spark: 'M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1',
  car: 'M5 16h14M6 16v2h2v-2m8 0v2h2v-2M4 16V9l2-4h12l2 4v7H4Zm3-7h10',
  fuel: 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 11h10m3-4 3 3v7a2 2 0 0 1-4 0v-5',
  device: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h4',
};

export function Icon({
  name,
  size = 20,
  className,
  strokeWidth = 1.9,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const d = PATHS[name] ?? PATHS.info;
  const filled = ['dashboard', 'play', 'pause', 'shock'].includes(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
