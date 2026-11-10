// The four illustrations on the home page, one per path. Each is a self-contained picture with its
// own fixed palette (it reads the same in light and dark mode, like a photo would). Decoration only:
// every scene is aria-hidden, and its motion (rain, water, power, server lights) stops under
// prefers-reduced-motion (index.css).

const TRIM = "#fffaf0";

// A shotgun house: front gable, gallery with iron-lace frieze, shuttered openings, raised on piers.
function House({ x, body, shutter, roof }) {
  const w = 130;
  const openings = [
    [13, 24],
    [52, 24],
    [90, 28],
  ];
  const columns = [2, 42, 81, 124];
  return (
    <g transform={`translate(${x} 0)`}>
      {[4, 46].map((px) => (
        <rect key={px} x={px} y="254" width="9" height="8" fill="#9a5b47" />
      ))}
      <polygon points={`-8,154 ${w / 2},98 ${w + 8},154`} fill={roof} />
      <polyline points={`-8,154 ${w / 2},98 ${w + 8},154`} fill="none" stroke={TRIM} strokeWidth="4" strokeLinejoin="round" />
      <path d={`M${w / 2 - 11} 142 A11 11 0 0 1 ${w / 2 + 11} 142 Z`} fill={TRIM} />
      <path d={`M${w / 2 - 7} 138H${w / 2 + 7}M${w / 2 - 9} 140.5H${w / 2 + 9}`} stroke={shutter} strokeWidth="1" />
      <rect x="0" y="152" width={w} height="102" fill={body} />
      <rect x="-4" y="150" width={w + 8} height="8" fill={TRIM} />
      {openings.map(([ox, ow]) => (
        <g key={ox}>
          <rect x={ox - 2} y="170" width={ow + 4} height="76" fill={TRIM} />
          <rect x={ox} y="172" width={ow} height="72" fill={shutter} />
          <rect x={ox} y="172" width={ow} height="72" fill="url(#hs-slats)" />
          <path d={`M${ox + ow / 2} 172V244`} stroke={TRIM} strokeWidth="1.2" opacity="0.7" />
        </g>
      ))}
      {columns.slice(0, -1).map((cx, i) => {
        const a = cx + 4;
        const b = columns[i + 1];
        const m = (a + b) / 2;
        return (
          <path
            key={cx}
            d={`M${a} 159Q${m} 175 ${b} 159M${m - 3} 163a3 3 0 1 0 6 0a3 3 0 1 0 -6 0`}
            fill="none"
            stroke={TRIM}
            strokeWidth="1.4"
          />
        );
      })}
      {columns.map((cx) => (
        <rect key={cx} x={cx} y="158" width="4" height="94" fill={TRIM} />
      ))}
      <rect x="-4" y="250" width={w + 8} height="4" fill={TRIM} />
      <rect x="88" y="254" width="32" height="4" fill="#d9c8b0" />
      <rect x="85" y="258" width="38" height="4" fill="#cdbba2" />
    </g>
  );
}

// A green streetcar with red trim, its trolley pole on the overhead wire. Drawn with its wheels at
// y=0 and its front at x=0, facing right.
function Streetcar() {
  return (
    <g>
      <path d="M-4 -46L22 -70" stroke="#2f2a33" strokeWidth="1.6" />
      <rect x="-128" y="-46" width="124" height="6" rx="3" fill="#24503a" />
      <rect x="-108" y="-50" width="84" height="5" rx="2" fill="#1d4230" />
      <rect x="-130" y="-41" width="128" height="32" rx="5" fill="#2f6b47" />
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={-122 + i * 12} y="-37" width="8" height="13" rx="1" fill="#f6e4b8" />
      ))}
      <rect x="-130" y="-21" width="128" height="3" fill="#b5392c" />
      <rect x="-130" y="-12" width="128" height="4" fill="#24503a" />
      <circle cx="-108" cy="-5" r="5" fill="#2a2427" />
      <circle cx="-26" cy="-5" r="5" fill="#2a2427" />
      <circle cx="-3" cy="-30" r="2" fill="#fff3c4" />
    </g>
  );
}

export function HousingScene() {
  return (
    <svg className="scene scene--housing" viewBox="0 0 640 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe6cb" />
          <stop offset="0.65" stopColor="#f6bb92" />
          <stop offset="1" stopColor="#ee9d7b" />
        </linearGradient>
        <pattern id="hs-slats" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M0 3.5H4" stroke="rgba(0,0,0,0.22)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="640" height="320" fill="url(#hs-sky)" />
      <circle cx="572" cy="118" r="42" fill="#fff3dc" opacity="0.85" />
      <path
        d="M0 214C30 190 60 196 84 182C110 168 140 186 168 176C200 164 230 182 262 172C296 160 330 184 362 174C396 162 430 180 462 170C500 158 540 182 572 172C600 164 624 176 640 170V262H0Z"
        fill="#e39b80"
        opacity="0.55"
      />
      <House x={22} body="#8fcab0" shutter="#2f6f5e" roof="#5f5668" />
      <House x={170} body="#f08b74" shutter="#33558a" roof="#5a5163" />
      <House x={318} body="#b9a7da" shutter="#4b3d7a" roof="#5f5668" />
      <House x={466} body="#f3cd68" shutter="#2f6f5e" roof="#5a5163" />
      <g>
        <rect x="160" y="190" width="3" height="72" fill="#2f2a33" />
        <path d="M155 182h13l-2 10h-9z" fill="#2f2a33" />
        <rect x="157" y="184" width="9" height="6" fill="#ffe7a8" />
      </g>
      <rect x="0" y="262" width="640" height="14" fill="#e8d9c3" />
      <rect x="0" y="276" width="640" height="2" fill="#bba88f" />
      <rect x="0" y="278" width="640" height="42" fill="#7a6a62" />
      <path d="M0 304H640M0 312H640" stroke="#a69488" strokeWidth="2" />
      <path d="M0 238H640" stroke="#3a3236" strokeWidth="0.9" opacity="0.7" />
      <g transform="translate(0 308)">
        <g className="scene-car">
          <Streetcar />
        </g>
      </g>
    </svg>
  );
}

// Moss strands hanging from the live oak, as [x, y, length].
const MOSS = [
  [36, 150, 34],
  [58, 158, 26],
  [86, 162, 38],
  [150, 160, 30],
  [178, 156, 40],
  [206, 150, 28],
  [232, 146, 24],
];

const FLAG_W = 46;
const FLAG_H = 26;
const FLAG_SLICE = 2;

// The US flag: 13 stripes and a blue canton with rows of stars (dots at this size).
function FlagArt() {
  const stripe = FLAG_H / 13;
  const cantonW = FLAG_W * 0.4;
  const cantonH = stripe * 7;
  const stars = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) stars.push([1.8 + c * 3.1 + (r % 2) * 1.5, 1.6 + r * 2.7]);
  return (
    <g>
      {Array.from({ length: 13 }, (_, i) => (
        <rect key={i} x="0" y={i * stripe} width={FLAG_W} height={stripe + 0.05} fill={i % 2 ? "#ffffff" : "#bf2f38"} />
      ))}
      <rect x="0" y="0" width={cantonW} height={cantonH} fill="#2c3f7a" />
      {stars
        .filter(([sx]) => sx < cantonW - 1)
        .map(([sx, sy]) => (
          <circle key={`${sx}-${sy}`} cx={sx} cy={sy} r="0.55" fill="#fff" />
        ))}
    </g>
  );
}

function UsFlag({ x, y }) {
  const n = FLAG_W / FLAG_SLICE;
  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <g id="us-flag">
          <FlagArt />
        </g>
      </defs>
      {Array.from({ length: n }, (_, i) => (
        <g key={i} className="scene-flag-slice" style={{ "--amp": `${0.4 + i * 0.13}px`, animationDelay: `${-i * 0.07}s` }}>
          <svg
            x={i * FLAG_SLICE}
            y="0"
            width={FLAG_SLICE + 0.15}
            height={FLAG_H}
            viewBox={`${i * FLAG_SLICE} 0 ${FLAG_SLICE + 0.15} ${FLAG_H}`}
          >
            <use href="#us-flag" />
          </svg>
          <rect
            className="scene-flag-shade"
            x={i * FLAG_SLICE}
            y="0"
            width={FLAG_SLICE + 0.15}
            height={FLAG_H}
            fill="#000"
            style={{ animationDelay: `${-i * 0.07}s` }}
          />
        </g>
      ))}
    </g>
  );
}

export function SchoolsScene() {
  const windows = [270, 300, 330, 474, 506, 538];
  return (
    <svg className="scene scene--schools" viewBox="0 0 640 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="ss-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#bfe0f3" />
          <stop offset="1" stopColor="#eef7fb" />
        </linearGradient>
        <pattern id="ss-brick" width="16" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 7.5H16M8 0V4M0 4H16M0 4V8" stroke="rgba(60,20,10,0.18)" strokeWidth="1" fill="none" />
        </pattern>
      </defs>
      <rect width="640" height="320" fill="url(#ss-sky)" />
      <g className="scene-clouds" fill="#fff" opacity="0.9">
        <ellipse cx="330" cy="54" rx="46" ry="12" />
        <ellipse cx="356" cy="46" rx="26" ry="12" />
        <ellipse cx="540" cy="76" rx="38" ry="9" />
      </g>
      {/* The school: brick wings, a white portico, a cupola with a bell. */}
      <rect x="250" y="134" width="320" height="10" fill="#a14b36" />
      <rect x="244" y="142" width="332" height="10" fill="#f3eee4" />
      <rect x="250" y="152" width="320" height="104" fill="#b65a42" />
      <rect x="250" y="152" width="320" height="104" fill="url(#ss-brick)" />
      {windows.flatMap((wx) =>
        [166, 208].map((wy) => (
          <g key={`${wx}-${wy}`}>
            <rect x={wx - 2} y={wy - 2} width="22" height="34" fill="#f3eee4" />
            <rect x={wx} y={wy} width="18" height="30" fill="#9cc3dc" />
            <path d={`M${wx + 9} ${wy}V${wy + 30}M${wx} ${wy + 15}H${wx + 18}`} stroke="#f3eee4" strokeWidth="1.5" />
          </g>
        )),
      )}
      <polygon points="356,152 410,110 464,152" fill="#f3eee4" />
      <polygon points="368,147 410,118 452,147" fill="none" stroke="#d8cfbd" strokeWidth="1.5" />
      <rect x="356" y="150" width="108" height="11" fill="#f3eee4" />
      <text
        x="410"
        y="158.5"
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        letterSpacing="2.5"
        fill="#8a6f55"
        fontFamily="Georgia, serif"
      >
        SCHOOL
      </text>
      <rect x="360" y="161" width="100" height="87" fill="#a65039" />
      <path d="M396 248V208a14 14 0 0 1 28 0V248Z" fill="#2f5d4b" />
      <path d="M410 196V248" stroke="#24493b" strokeWidth="1.5" />
      {[364, 386, 426, 448].map((cx) => (
        <rect key={cx} x={cx} y="161" width="8" height="87" fill="#f8f4ec" />
      ))}
      <rect x="350" y="248" width="120" height="4" fill="#e2d9c8" />
      <rect x="344" y="252" width="132" height="4" fill="#d6ccb9" />
      <rect x="398" y="92" width="24" height="18" fill="#f3eee4" />
      <rect x="404" y="96" width="12" height="11" fill="#5b4a3c" />
      <path d="M407 104q3-7 6 0z" fill="#d4a63a" />
      <path d="M395 93Q410 70 425 93Z" fill="#6f8f8a" />
      <path d="M410 76V62" stroke="#6f8f8a" strokeWidth="2" />
      {/* Flagpole and a US flag, waving: the flag is cut into thin vertical slices that rise and
          fall a step apart, more the farther they are from the pole. */}
      <path d="M586 98V256" stroke="#9aa3ab" strokeWidth="3" />
      <circle cx="586" cy="97" r="2.6" fill="#c9b27a" />
      <UsFlag x={588} y={102} />
      {/* Lawn, path and hedges. */}
      <rect x="0" y="256" width="640" height="64" fill="#8fbf6d" />
      <rect x="0" y="256" width="640" height="5" fill="#7aa95b" />
      <polygon points="396,256 424,256 488,320 332,320" fill="#ebdfc7" />
      {[262, 292, 322, 478, 512, 546].map((bx) => (
        <ellipse key={bx} cx={bx} cy="256" rx="18" ry="9" fill="#5e8f47" />
      ))}
      {/* A live oak with Spanish moss. */}
      <path
        d="M118 262C122 230 116 214 124 192C130 176 128 166 132 150L146 152C142 170 146 182 142 196C138 214 146 236 142 262Z"
        fill="#5a4636"
      />
      <path
        d="M128 182C100 172 70 168 30 152M136 176C164 164 200 160 244 140M130 168C120 150 108 140 90 128"
        stroke="#5a4636"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
      <g fill="#4f7f3b">
        <circle cx="40" cy="128" r="34" />
        <circle cx="96" cy="104" r="42" />
        <circle cx="156" cy="96" r="44" />
        <circle cx="214" cy="116" r="38" />
        <circle cx="250" cy="132" r="22" />
      </g>
      <g fill="#3f6b30">
        <circle cx="70" cy="140" r="26" />
        <circle cx="130" cy="138" r="30" />
        <circle cx="190" cy="140" r="26" />
      </g>
      <g fill="#6a9a4c" opacity="0.8">
        <circle cx="112" cy="86" r="18" />
        <circle cx="168" cy="78" r="16" />
        <circle cx="64" cy="112" r="14" />
      </g>
      <g stroke="#b8c2a6" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.85">
        {MOSS.map(([mx, my, len]) => (
          <path key={mx} d={`M${mx} ${my}q-3 ${len / 3} 1 ${len / 1.6}q3 ${len / 4} -1 ${len - len / 1.6}`} />
        ))}
      </g>
    </svg>
  );
}

// Rain streaks on a fixed grid so the scene renders the same every time.
// Two stacked copies (one a screen above the other) so the fall loops without a jump.
const RAIN = Array.from({ length: 56 }, (_, i) => [(i * 53) % 780, (i * 37) % 320]);

export function FloodScene() {
  return (
    <svg className="scene scene--flood" viewBox="0 0 640 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="fs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f6f92" />
          <stop offset="1" stopColor="#a6c0d4" />
        </linearGradient>
        <linearGradient id="fs-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4d86ad" />
          <stop offset="1" stopColor="#2c5f86" />
        </linearGradient>
      </defs>
      <rect width="640" height="320" fill="url(#fs-sky)" />
      <g className="scene-clouds scene-clouds--fast" fill="#3f5c7c" opacity="0.55">
        <ellipse cx="120" cy="58" rx="110" ry="26" />
        <ellipse cx="420" cy="44" rx="150" ry="28" />
        <ellipse cx="610" cy="70" rx="90" ry="22" />
      </g>
      {/* The river sits higher than the street, held back by the levee and floodwall. */}
      <rect x="0" y="166" width="140" height="100" fill="url(#fs-water)" />
      <path d="M0 166q12-4 24 0t24 0t24 0t24 0t24 0t24 0" fill="none" stroke="#9fc6df" strokeWidth="2" opacity="0.7" />
      <polygon points="96,262 132,170 168,170 246,262" fill="#6f9a5a" />
      <polygon points="132,170 168,170 176,182 128,182" fill="#7fab68" />
      <rect x="138" y="132" width="10" height="40" fill="#c4c9cf" />
      <rect x="138" y="132" width="10" height="4" fill="#e4e7ea" />
      {/* Pump station. */}
      <rect x="256" y="214" width="56" height="48" fill="#d9d2c4" />
      <rect x="252" y="208" width="64" height="8" fill="#8f8577" />
      <g stroke="#9c9284" strokeWidth="2">
        <path d="M266 226h36M266 232h36M266 238h36" />
      </g>
      <rect x="276" y="246" width="16" height="16" fill="#6c6458" />
      {/* A house raised on piers, and one built on the ground. */}
      <g>
        {[338, 372, 414].map((px) => (
          <rect key={px} x={px} y="218" width="8" height="44" fill="#8a7d70" />
        ))}
        <polygon points="326,152 380,112 434,152" fill="#4f4a57" />
        <rect x="332" y="150" width="96" height="70" fill="#e9d6a8" />
        <rect x="344" y="166" width="18" height="30" fill="#5d7f9b" />
        <rect x="398" y="166" width="18" height="30" fill="#5d7f9b" />
        <rect x="370" y="176" width="20" height="44" fill="#7a4f3a" />
        <path d="M352 220L340 262M408 220L420 262" stroke="#6e6357" strokeWidth="3" />
      </g>
      <g>
        <polygon points="466,196 520,160 574,196" fill="#5a5163" />
        <rect x="472" y="194" width="96" height="68" fill="#c9dccf" />
        <rect x="484" y="208" width="18" height="28" fill="#5d7f9b" />
        <rect x="538" y="208" width="18" height="28" fill="#5d7f9b" />
        <rect x="510" y="214" width="20" height="48" fill="#7a4f3a" />
      </g>
      {/* Depth gauge. */}
      <g>
        <rect x="598" y="176" width="16" height="130" fill="#f6f4ef" />
        {Array.from({ length: 10 }, (_, i) => (
          <path key={i} d={`M598 ${186 + i * 12}h${i % 2 ? 6 : 10}`} stroke="#c0392b" strokeWidth="2" />
        ))}
      </g>
      {/* Standing water in the street, drifting. */}
      <rect x="0" y="262" width="640" height="58" fill="#7d8c96" />
      <g className="scene-water-level">
        <g className="scene-water">
          <path
            d="M0 256q20-6 40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0V320H0Z"
            fill="#3e77a0"
            opacity="0.85"
          />
          <path
            d="M0 262q20 5 40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0t40 0"
            fill="none"
            stroke="#a9d0e8"
            strokeWidth="2"
            opacity="0.6"
          />
        </g>
      </g>
      <g className="scene-rain" stroke="#e6f0f7" strokeWidth="1.3" opacity="0.5" strokeLinecap="round">
        {[0, -320].flatMap((dy) => RAIN.map(([rx, ry]) => <path key={`${dy}-${rx}-${ry}`} d={`M${rx} ${ry + dy - 20}l-6 16`} />))}
      </g>
    </svg>
  );
}

// A transmission tower: two tapering legs, cross-bracing and one crossarm.
function Tower({ x }) {
  const top = 140;
  const ground = 262;
  const legAt = (y) => 4 + ((y - top) / (ground - top)) * 12;
  const levels = [160, 186, 212, 238, 262];
  const brace = levels
    .slice(0, -1)
    .map((y, i) => {
      const y2 = levels[i + 1];
      return `M${x - legAt(y)} ${y}L${x + legAt(y2)} ${y2}M${x + legAt(y)} ${y}L${x - legAt(y2)} ${y2}`;
    })
    .join("");
  return (
    <g stroke="#6f86c4" strokeWidth="1.6" fill="none" opacity="0.85">
      <path d={`M${x - 16} ${ground}L${x - 4} ${top}L${x} ${top - 12}L${x + 4} ${top}L${x + 16} ${ground}`} strokeWidth="2.2" />
      <path d={`M${x - 18} 150H${x + 18}M${x - 18} 150L${x} 140L${x + 18} 150`} strokeWidth="2" />
      <path d={brace} strokeWidth="1.1" />
    </g>
  );
}

const STARS = Array.from({ length: 26 }, (_, i) => [(i * 97 + 23) % 640, (i * 41 + 11) % 120, i % 3 === 0 ? 1.4 : 0.9]);
const LEDS = Array.from({ length: 3 * 22 }, (_, i) => [392 + (i % 22) * 10, 214 + Math.floor(i / 22) * 16, i]);
const LINE_A = "M180 186Q198 176 212 150Q257 166 302 150Q342 170 386 200";
const LINE_B = "M186 192Q224 176 248 150Q293 166 338 150Q360 172 396 200";

export function PowerScene() {
  return (
    <svg className="scene scene--power" viewBox="0 0 640 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="ps-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#060b1d" />
          <stop offset="1" stopColor="#16244f" />
        </linearGradient>
        <pattern id="ps-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke="rgba(54,214,195,0.08)" strokeWidth="1" />
        </pattern>
        <radialGradient id="ps-glow" cx="0.78" cy="0.75" r="0.5">
          <stop offset="0" stopColor="rgba(54,214,195,0.28)" />
          <stop offset="1" stopColor="rgba(54,214,195,0)" />
        </radialGradient>
      </defs>
      <rect width="640" height="320" fill="url(#ps-sky)" />
      <rect width="640" height="320" fill="url(#ps-grid)" />
      <rect width="640" height="320" fill="url(#ps-glow)" />
      <g fill="#cfd8ff">
        {STARS.map(([sx, sy, r]) => (
          <circle key={`${sx}-${sy}`} cx={sx} cy={sy} r={r} opacity="0.7" />
        ))}
      </g>
      {/* Gas plant: two stacks with drifting plumes. */}
      <g className="scene-plume" fill="#8a93b8">
        <circle cx="67" cy="108" r="12" opacity="0.22" />
        <circle cx="103" cy="104" r="14" opacity="0.18" />
      </g>
      <rect x="60" y="118" width="14" height="96" fill="#2a3152" />
      <rect x="96" y="112" width="14" height="102" fill="#2a3152" />
      <rect x="60" y="126" width="14" height="5" fill="#d4922a" />
      <rect x="96" y="120" width="14" height="5" fill="#d4922a" />
      <rect x="30" y="212" width="140" height="50" fill="#1d2440" />
      <rect x="30" y="212" width="140" height="3" fill="#d4922a" opacity="0.8" />
      <rect x="42" y="226" width="40" height="22" fill="#262f52" />
      <rect x="92" y="226" width="64" height="22" fill="#262f52" />
      <path d="M176 262V182M190 262V182M172 184H194" stroke="#6f86c4" strokeWidth="2" />
      <Tower x={230} />
      <Tower x={320} />
      <path d={LINE_A} fill="none" stroke="#5b6fa8" strokeWidth="1.2" />
      <path d={LINE_B} fill="none" stroke="#5b6fa8" strokeWidth="1.2" />
      <path className="scene-pulse" d={LINE_A} fill="none" stroke="#e3a93e" strokeWidth="3" strokeLinecap="round" />
      <path className="scene-pulse scene-pulse--late" d={LINE_B} fill="none" stroke="#36d6c3" strokeWidth="3" strokeLinecap="round" />
      {/* The data center: a long low hall, cooling units on the roof, rows of server lights. */}
      {[398, 450, 502, 554].map((ux) => (
        <g key={ux}>
          <rect x={ux} y="186" width="40" height="12" fill="#1a2650" stroke="#2f4380" />
          <circle cx={ux + 11} cy="192" r="4" fill="none" stroke="#36d6c3" strokeWidth="1" opacity="0.6" />
          <circle cx={ux + 29} cy="192" r="4" fill="none" stroke="#36d6c3" strokeWidth="1" opacity="0.6" />
        </g>
      ))}
      <rect x="380" y="198" width="240" height="64" fill="#111a38" stroke="#2a3d70" />
      <rect x="380" y="198" width="240" height="2" fill="#36d6c3" opacity="0.7" />
      {LEDS.map(([lx, ly, i]) => (
        <rect
          key={i}
          className="scene-led"
          x={lx}
          y={ly}
          width="6"
          height="3"
          rx="1"
          fill={i % 5 === 0 ? "#7c8cff" : "#36d6c3"}
          style={{ animationDelay: `${((i * 37) % 23) / 10}s` }}
        />
      ))}
      <rect x="0" y="262" width="640" height="58" fill="#0a1126" />
      <rect x="0" y="262" width="640" height="1.5" fill="#36d6c3" opacity="0.35" />
    </svg>
  );
}
