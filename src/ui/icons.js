const svg = (body, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  up: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  down: svg('<path d="M12 5v14M5 12l7 7 7-7"/>'),
  narrow: svg('<path d="M3 12h6M6 9l3 3-3 3M21 12h-6M18 9l-3 3 3 3"/>'),
  widen: svg('<path d="M9 12H3M6 9l-3 3 3 3M15 12h6M18 9l3 3-3 3"/>'),
  tiltBack: svg('<path d="M8 20V8a4 4 0 0 1 4-4h0"/><path d="M5 8l3-4 3 4"/><path d="M8 20h10"/>'),
  tiltFwd: svg('<path d="M16 20V8a4 4 0 0 0-4-4h0"/><path d="M13 8l3-4 3 4"/><path d="M6 20h10"/>'),
  arrowLeft: svg('<path d="M15 4l-8 8 8 8"/>'),
  arrowRight: svg('<path d="M9 4l8 8-8 8"/>'),
  wheel: svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2.5"/><path d="M12 14.5V22M9.6 11.2L2.4 9M14.4 11.2L21.6 9"/>'),
  pedal: svg('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M9 7h6M9 11h6M9 15h6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  map: svg('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'),
  globe: svg('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  back: svg('<path d="M15 4l-8 8 8 8"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  coin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#f7c531" stroke="#c98a06" stroke-width="2"/><circle cx="12" cy="12" r="6" fill="none" stroke="#e9a90f" stroke-width="2"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z" fill="#ffd23f" stroke="#e0a800" stroke-width="1.2"/></svg>',
  starOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z" fill="#c9d3dc" stroke="#9aa8b5" stroke-width="1.2"/></svg>',
  truck: svg('<path d="M1 6h13v10H1zM14 10h4l3 3v3h-7z"/><circle cx="5" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  forklift: svg('<path d="M3 18V9h6l3 5v4M19 3v15h3M15 8h4M15 14h4"/><circle cx="6" cy="19" r="2"/><circle cx="12" cy="19" r="2"/>'),
  warehouse: svg('<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-8h10v8M7 17h10"/>'),
  workers: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2A5 5 0 0 1 21.5 19"/>'),
  contract: svg('<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>'),

  // orario e meteo dei contratti
  sun: svg('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>'),
  sunset: svg('<path d="M3 18h18M6 18a6 6 0 0 1 12 0M12 4v4M9.5 6.5L12 9l2.5-2.5M4 12.5l1.6.8M20 12.5l-1.6.8M3 22h18"/>'),
  dawn: svg('<path d="M3 18h18M6 18a6 6 0 0 1 12 0M12 9V5M9.5 6.5L12 4l2.5 2.5M4 12.5l1.6.8M20 12.5l-1.6.8M3 22h18"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  rain: svg('<path d="M7 15a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.5 8 3.5 3.5 0 0 1 18 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>'),
  snow: svg('<path d="M7 14a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.5 7 3.5 3.5 0 0 1 18 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 22h.01M14 22h.01"/>'),
  fog: svg('<path d="M4 9h16M2 13h20M5 17h14M8 21h8"/>'),
  headlight: svg('<path d="M10 5c-3.9 0-6 3-6 7s2.1 7 6 7z"/><path d="M14 8h7M14 12h7M14 16h7"/>'),
  trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="#ffd23f" stroke="#c99400" stroke-width="1.4"/><path d="M7 5H4v1.5A3.5 3.5 0 0 0 7.5 10M17 5h3v1.5A3.5 3.5 0 0 1 16.5 10" fill="none" stroke="#c99400" stroke-width="1.6"/><path d="M10.5 13h3l.6 4h-4.2z" fill="#e0a800"/><rect x="7.5" y="17" width="9" height="3.5" rx="1" fill="#8a5a1c"/></svg>',
  camera: svg('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pallets: svg('<path d="M4 4h7v6H4zM13 4h7v6h-7zM8.5 12h7v6h-7zM3 20h18"/>'),
  drop: svg('<path d="M5 16V8h6l3 4v4M17 4v12h3M14 7h3"/><circle cx="8" cy="18" r="1.6"/><path d="M20 19l-3 2M14 21l-2-2"/>'),
  wheel3: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="43" fill="none" stroke="#15171a" stroke-width="11"/>
    <circle cx="50" cy="50" r="43" fill="none" stroke="#4a4f57" stroke-width="2.5" stroke-dasharray="3 5"/>
    <path d="M50 50L9 58M50 50L91 58M50 50L50 93" stroke="#1f2226" stroke-width="10" stroke-linecap="round"/>
    <circle cx="50" cy="50" r="14" fill="#2b2f35" stroke="#5c626b" stroke-width="2.5"/>
    <circle cx="50" cy="50" r="5" fill="#8a9099"/>
    <circle cx="77" cy="20" r="6.5" fill="#3a3f46" stroke="#15171a" stroke-width="3"/>
  </svg>`,
  brakePedal: `<svg viewBox="0 0 60 70" aria-hidden="true">
    <rect x="2" y="2" width="56" height="66" rx="8" fill="#26292d" stroke="#0f1012" stroke-width="3"/>
    <rect x="7" y="7" width="46" height="56" rx="5" fill="#33373c"/>
    <g fill="#1a1c1f">${Array.from({ length: 30 }, (_, i) => `<rect x="${10 + (i % 5) * 9}" y="${10 + Math.floor(i / 5) * 9}" width="5" height="5" rx="1"/>`).join('')}</g>
  </svg>`,
  gasPedal: `<svg viewBox="0 0 44 90" aria-hidden="true">
    <rect x="2" y="2" width="40" height="86" rx="9" fill="#26292d" stroke="#0f1012" stroke-width="3"/>
    <rect x="7" y="7" width="30" height="76" rx="6" fill="#33373c"/>
    <g fill="#1a1c1f">${Array.from({ length: 8 }, (_, i) => `<rect x="11" y="${12 + i * 8.6}" width="22" height="4" rx="2"/>`).join('')}</g>
    <circle cx="22" cy="80" r="2.5" fill="#8a9099"/>
  </svg>`,
};
