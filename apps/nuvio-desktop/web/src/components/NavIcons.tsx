// Sidebar icons in the app icon's palette: filled shapes with a blue → cyan gradient, a dark
// outline and a soft highlight (drawn as SVG so they stay sharp at any scale).

const OUTLINE = "#0b1a2e";

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-main`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#bdf6ff" />
        <stop offset="0.55" stopColor="#5fd3f0" />
        <stop offset="1" stopColor="#2f8fd6" />
      </linearGradient>
      <linearGradient id={`${id}-deep`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#4cc3ec" />
        <stop offset="1" stopColor="#2a6fc4" />
      </linearGradient>
      <linearGradient id={`${id}-screen`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3a4b63" />
        <stop offset="1" stopColor="#1d2738" />
      </linearGradient>
    </defs>
  );
}

export function HomeIcon() {
  const id = "nav-home";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <rect x="31" y="9" width="5" height="9" rx="1" fill={`url(#${id}-deep)`} stroke={OUTLINE} strokeWidth="2" />
      <path d="M24 7 L43 23 a2 2 0 0 1 -1.3 3.5 H39 V40 a2 2 0 0 1 -2 2 H11 a2 2 0 0 1 -2 -2 V26.5 H6.3 A2 2 0 0 1 5 23 Z"
        fill={`url(#${id}-main)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M8 23.5 L24 10 L40 23.5" fill="none" stroke="#e9fdff" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M19 42 V32 a5 5 0 0 1 10 0 V42 Z" fill="#163152" stroke={OUTLINE} strokeWidth="2" />
    </svg>
  );
}

export function TvIcon() {
  const id = "nav-tv";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <path d="M17 6 L24 13 L31 6" fill="none" stroke="#6fd4ef" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16.5" cy="5.5" r="2.2" fill="#9be8fb" stroke={OUTLINE} strokeWidth="1.4" />
      <circle cx="31.5" cy="5.5" r="2.2" fill="#9be8fb" stroke={OUTLINE} strokeWidth="1.4" />
      <rect x="4" y="13" width="40" height="26" rx="5" fill={`url(#${id}-deep)`} stroke={OUTLINE} strokeWidth="2.4" />
      <rect x="8" y="17" width="25" height="18" rx="3" fill={`url(#${id}-screen)`} stroke={OUTLINE} strokeWidth="1.6" />
      <path d="M18 21.5 L25.5 26 L18 30.5 Z" fill="#ffffff" />
      <circle cx="38.5" cy="20" r="2" fill="#173356" stroke="#bdf6ff" strokeWidth="1" />
      <circle cx="38.5" cy="26" r="2" fill="#173356" stroke="#bdf6ff" strokeWidth="1" />
      <path d="M36 31.5 h5 M36 34 h5" stroke="#173356" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M15 39 L13 43 H35 L33 39" fill={`url(#${id}-deep)`} stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon() {
  const id = "nav-search";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <radialGradient id={`${id}-lens`} cx="0.38" cy="0.35" r="0.75">
        <stop offset="0" stopColor="#f2fdff" />
        <stop offset="0.5" stopColor="#bfe9fb" />
        <stop offset="1" stopColor="#6fb6e8" />
      </radialGradient>
      <path d="M28.5 29.5 L41 42" stroke={OUTLINE} strokeWidth="8.5" strokeLinecap="round" />
      <path d="M28.5 29.5 L41 42" stroke={`url(#${id}-deep)`} strokeWidth="5" strokeLinecap="round" />
      <circle cx="21" cy="20" r="14" fill={`url(#${id}-deep)`} stroke={OUTLINE} strokeWidth="2.4" />
      <circle cx="21" cy="20" r="10" fill={`url(#${id}-lens)`} stroke={OUTLINE} strokeWidth="1.4" />
      <path d="M14.5 17 a7 7 0 0 1 6.5 -5" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function LibraryIcon() {
  const id = "nav-lib";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <rect x="17" y="17" width="25" height="25" rx="4.5" fill="#2f6dc0" stroke={OUTLINE} strokeWidth="2.2" />
      <rect x="11.5" y="11.5" width="25" height="25" rx="4.5" fill="#3f93dc" stroke={OUTLINE} strokeWidth="2.2" />
      <rect x="6" y="6" width="25" height="25" rx="4.5" fill="#62e6ef" stroke={OUTLINE} strokeWidth="2.2" />
      <path d="M10 10.5 h14" stroke="#e8fffd" strokeOpacity=".7" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon() {
  const id = "nav-gear";
  const teeth = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <g stroke={OUTLINE} strokeWidth="2.2" strokeLinejoin="round">
        {teeth.map((a) => (
          <rect key={a} x="20.5" y="3.5" width="7" height="9" rx="1.8" fill={`url(#${id}-deep)`} transform={`rotate(${a} 24 24)`} />
        ))}
        <circle cx="24" cy="24" r="15" fill={`url(#${id}-main)`} />
      </g>
      <circle cx="24" cy="24" r="6.5" fill="#173356" stroke={OUTLINE} strokeWidth="2" />
      <circle cx="24" cy="24" r="3" fill="#5fd3f0" />
    </svg>
  );
}

// ---------- Settings sections (same style, drawn smaller) ----------

export function AccountIcon() {
  const id = "set-account";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <path d="M14 38 a9 9 0 0 1 -1.2 -17.9 A12 12 0 0 1 35.6 17.5 A10.5 10.5 0 0 1 35.5 38 Z"
        fill={`url(#${id}-main)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M17 21 a8.5 8.5 0 0 1 12.5 -5" fill="none" stroke="#ffffff" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" />
      <path d="M24 26 v8 M20 30 l4 -4 l4 4" fill="none" stroke="#163152" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AddonsIcon() {
  const id = "set-addons";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <path d="M8 14 h9 a5 5 0 1 1 10 0 h9 v9 a5 5 0 1 0 0 10 v9 H27 a5 5 0 1 0 -10 0 H8 v-9 a5 5 0 1 1 0 -10 Z"
        fill={`url(#${id}-main)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M11 18 v6" stroke="#ffffff" strokeOpacity=".6" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function PlaybackIcon() {
  const id = "set-play";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <circle cx="24" cy="24" r="19" fill={`url(#${id}-deep)`} stroke={OUTLINE} strokeWidth="2.4" />
      <circle cx="24" cy="24" r="14" fill={`url(#${id}-screen)`} stroke={OUTLINE} strokeWidth="1.4" />
      <path d="M20 16.5 L32 24 L20 31.5 Z" fill="#ffffff" stroke={OUTLINE} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function P2pIcon() {
  const id = "set-p2p";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <path d="M15 40 V14 H9 L18 4 L27 14 H21 V40 Z" fill={`url(#${id}-main)`} stroke={OUTLINE} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M33 8 V34 H39 L30 44 L21 34 H27 V8 Z" fill={`url(#${id}-deep)`} stroke={OUTLINE} strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

export function AudioIcon() {
  const id = "set-audio";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <path d="M6 18 h8 l11 -9 v30 l-11 -9 H6 Z" fill={`url(#${id}-main)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M31 17 a9 9 0 0 1 0 14" fill="none" stroke={OUTLINE} strokeWidth="5.5" strokeLinecap="round" />
      <path d="M31 17 a9 9 0 0 1 0 14" fill="none" stroke="#6fd4ef" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M36 11 a17 17 0 0 1 0 26" fill="none" stroke={OUTLINE} strokeWidth="5.5" strokeLinecap="round" />
      <path d="M36 11 a17 17 0 0 1 0 26" fill="none" stroke="#3f93dc" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

export function SubtitlesIcon() {
  const id = "set-subs";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <rect x="4" y="9" width="40" height="30" rx="6" fill={`url(#${id}-deep)`} stroke={OUTLINE} strokeWidth="2.4" />
      <path d="M10 27 h11 M25 27 h13 M10 33 h18 M32 33 h6" stroke="#e9fdff" strokeWidth="3" strokeLinecap="round" />
      <path d="M9 14 h12" stroke="#ffffff" strokeOpacity=".5" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ProfileDataIcon() {
  const id = "set-data";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <path d="M5 12 a3 3 0 0 1 3 -3 h11 l4 4 h17 a3 3 0 0 1 3 3 v21 a3 3 0 0 1 -3 3 H8 a3 3 0 0 1 -3 -3 Z"
        fill={`url(#${id}-deep)`} stroke={OUTLINE} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M5 19 h38 v18 a3 3 0 0 1 -3 3 H8 a3 3 0 0 1 -3 -3 Z" fill={`url(#${id}-main)`} stroke={OUTLINE} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="24" cy="26.5" r="3.6" fill="#163152" />
      <path d="M17.5 36.5 a6.5 6.5 0 0 1 13 0" fill="#163152" />
    </svg>
  );
}

export function UpdatesIcon() {
  const id = "set-updates";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <path d="M38 20 A15 15 0 0 0 11 15" fill="none" stroke={OUTLINE} strokeWidth="7.5" strokeLinecap="round" />
      <path d="M38 20 A15 15 0 0 0 11 15" fill="none" stroke={`url(#${id}-main)`} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M10 28 A15 15 0 0 0 37 33" fill="none" stroke={OUTLINE} strokeWidth="7.5" strokeLinecap="round" />
      <path d="M10 28 A15 15 0 0 0 37 33" fill="none" stroke={`url(#${id}-deep)`} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M5 9 L13 21 L18 9 Z" fill="#9be8fb" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
      <path d="M43 39 L35 27 L30 39 Z" fill="#3f93dc" stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function PendingIcon() {
  const id = "set-pending";
  return (
    <svg viewBox="0 0 48 48" aria-hidden>
      <Defs id={id} />
      <circle cx="24" cy="24" r="19" fill={`url(#${id}-main)`} stroke={OUTLINE} strokeWidth="2.4" />
      <circle cx="24" cy="24" r="14.5" fill="#163152" stroke={OUTLINE} strokeWidth="1.2" />
      <path d="M24 14 V24 L31 28" fill="none" stroke="#9be8fb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="24" r="2.2" fill="#ffffff" />
    </svg>
  );
}
