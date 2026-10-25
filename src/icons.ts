const paths = {
  zoomIn:
    '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M7 10h6m-3-3v6"/>',
  zoomOut: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M7 10h6"/>',
  details: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  photos:
    '<rect x="4" y="5" width="16" height="16" rx="4"/><path d="M7 2h10M5 16l5-5 4 4 2-2 4 4"/><circle cx="15" cy="10" r="1"/>',

  power: '<path d="M12 3v9M6.5 5.5a8 8 0 1 0 11 0"/>',
  brand: '<path d="M5 5h14L5 19h14M8 12h8"/>',
  quality:
    '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9Z"/>',
  layout:
    '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M9 5v14m4-9h4m-4 4h4"/>',
  retry:
    '<path d="M4 10a8 8 0 0 1 13.7-3.7L20 9M20 4v5h-5M20 14a8 8 0 0 1-13.7 3.7L4 15m0 5v-5h5"/>',
  warning:
    '<path d="m10.3 4.5-8 14A1.7 1.7 0 0 0 3.8 21h16.4a1.7 1.7 0 0 0 1.5-2.5l-8-14a2 2 0 0 0-3.4 0ZM12 9v5m0 3v.1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  privacy:
    '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',

  zip: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M10 4v2m0 2v2m0 2v2"/><rect x="8" y="16" width="4" height="3" rx="1"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
  select:
    '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="m8 12 3 3 5-6"/>',
  scan: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3M6 12h12m-9 4 3 3 3-3m-3-9v12"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="4"/>',
  download:
    '<path d="M12 3v12m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  library:
    '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  all: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 4H6a2 2 0 0 0-2 2v10m7-2 3 3 4-5"/>',
  clear:
    '<path d="m8 8 8 8m0-8-8 8"/><rect x="3" y="3" width="18" height="18" rx="6"/>',
  minimize: '<path d="M6 12h12"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  compact: '<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m18 0h-5v5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  reset: '<path d="M4 11a8 8 0 1 1 2 7M4 4v7h7"/>',
  settings:
    '<path d="m9 3-.7 3-2.8 1-2.2 2 1.8 2.5v2.9L3.3 17l2.2 2 2.8 1 .7 2h6l.7-2 2.8-1 2.2-2-1.8-2.6v-2.9L20.7 9l-2.2-2-2.8-1L15 3Z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
  pin: '<path d="M9 4h6l-1 5 3 3v2h-5v6l-1 1-1-1v-6H7v-2l3-3Z"/>',
} as const;
export type IconName = keyof typeof paths;
export function iconSVG(name: IconName) {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
export function iconElement(name: IconName) {
  const template = document.createElement("template");
  template.innerHTML = iconSVG(name);
  return template.content.firstElementChild!;
}
