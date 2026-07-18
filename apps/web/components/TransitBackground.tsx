"use client";

/**
 * Decorative Lagos-transit backdrop: a danfo bus, a car and a bike (okada)
 * riding along a subtle road, themed to match light/dark mode.
 *
 * Accessibility:
 *  - Purely decorative → aria-hidden and role="presentation"; never announced.
 *  - Sits behind content at low opacity so foreground text keeps its WCAG
 *    contrast (the tokens themselves are unchanged).
 *  - Motion is opt-in: vehicles only drift when the user hasn't asked for
 *    reduced motion (see the media query below).
 */
export default function TransitBackground() {
  return (
    <div className="transit-bg" aria-hidden role="presentation">
      {/* Bus (danfo) */}
      <svg className="vehicle bus" viewBox="0 0 120 60" width="120" height="60">
        <rect x="4" y="10" width="104" height="34" rx="6" fill="var(--tb-bus)" />
        <rect x="10" y="16" width="20" height="14" rx="2" fill="var(--tb-glass)" />
        <rect x="34" y="16" width="20" height="14" rx="2" fill="var(--tb-glass)" />
        <rect x="58" y="16" width="20" height="14" rx="2" fill="var(--tb-glass)" />
        <rect x="82" y="16" width="18" height="14" rx="2" fill="var(--tb-glass)" />
        <rect x="4" y="34" width="104" height="6" fill="var(--tb-stripe)" />
        <circle cx="30" cy="46" r="8" fill="var(--tb-wheel)" />
        <circle cx="88" cy="46" r="8" fill="var(--tb-wheel)" />
      </svg>

      {/* Car */}
      <svg className="vehicle car" viewBox="0 0 110 50" width="110" height="50">
        <path
          d="M6 34 L18 34 L28 18 L74 18 L90 34 L104 34 L104 40 L6 40 Z"
          fill="var(--tb-car)"
        />
        <path d="M32 20 L52 20 L52 33 L24 33 Z" fill="var(--tb-glass)" />
        <path d="M56 20 L72 20 L84 33 L56 33 Z" fill="var(--tb-glass)" />
        <circle cx="30" cy="41" r="7" fill="var(--tb-wheel)" />
        <circle cx="82" cy="41" r="7" fill="var(--tb-wheel)" />
      </svg>

      {/* Bike (okada) */}
      <svg className="vehicle bike" viewBox="0 0 90 50" width="90" height="50">
        <circle cx="20" cy="36" r="11" fill="none" stroke="var(--tb-wheel)" strokeWidth="3" />
        <circle cx="70" cy="36" r="11" fill="none" stroke="var(--tb-wheel)" strokeWidth="3" />
        <path
          d="M20 36 L40 36 L52 22 L60 22 M40 36 L58 22 M70 36 L58 22"
          fill="none"
          stroke="var(--tb-bike)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="49" cy="16" r="5" fill="var(--tb-bike)" />
        <path d="M30 34 L44 34 L48 28 L34 28 Z" fill="var(--tb-bike)" />
      </svg>

      <style jsx>{`
        .transit-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          overflow: hidden;
          /* A soft, low-contrast road band across the lower third. */
          background:
            linear-gradient(
              to bottom,
              transparent 0%,
              transparent 62%,
              var(--tb-road) 62%,
              var(--tb-road) 100%
            );
        }
        /* Dashed lane markings. */
        .transit-bg::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 18%;
          height: 3px;
          background: repeating-linear-gradient(
            to right,
            var(--tb-lane) 0 26px,
            transparent 26px 52px
          );
          opacity: 0.7;
        }

        /* Token defaults (light). */
        :global(:root) {
          --tb-road: rgba(17, 17, 17, 0.04);
          --tb-lane: rgba(17, 17, 17, 0.16);
          --tb-bus: rgba(255, 212, 0, 0.5);
          --tb-car: rgba(0, 80, 179, 0.28);
          --tb-bike: rgba(17, 17, 17, 0.3);
          --tb-glass: rgba(255, 255, 255, 0.55);
          --tb-wheel: rgba(17, 17, 17, 0.42);
          --tb-stripe: rgba(0, 80, 179, 0.35);
        }
        :global(html[data-theme="dark"]) {
          --tb-road: rgba(255, 255, 255, 0.03);
          --tb-lane: rgba(255, 255, 255, 0.12);
          --tb-bus: rgba(255, 212, 0, 0.22);
          --tb-car: rgba(90, 140, 230, 0.22);
          --tb-bike: rgba(240, 240, 235, 0.22);
          --tb-glass: rgba(255, 255, 255, 0.12);
          --tb-wheel: rgba(240, 240, 235, 0.3);
          --tb-stripe: rgba(90, 140, 230, 0.3);
        }

        .vehicle {
          position: absolute;
          bottom: 15%;
          opacity: 0.9;
          will-change: transform;
        }
        .bus {
          left: -140px;
          animation: drive 26s linear infinite;
        }
        .car {
          left: -130px;
          bottom: 16%;
          animation: drive 19s linear infinite;
          animation-delay: 6s;
        }
        .bike {
          left: -110px;
          bottom: 14.5%;
          animation: drive 15s linear infinite;
          animation-delay: 11s;
        }
        @keyframes drive {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(calc(100vw + 160px));
          }
        }

        /* Respect reduced-motion: park the vehicles in a static scene. */
        @media (prefers-reduced-motion: reduce) {
          .bus {
            left: 8%;
            animation: none;
          }
          .car {
            left: 46%;
            animation: none;
          }
          .bike {
            left: 78%;
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
