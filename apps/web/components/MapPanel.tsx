"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window` on import, so the map must be client-only (no SSR).
const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="maploading">Loading map…</div>,
});

interface Props {
  open: boolean;
  onClose: () => void;
  route: string[];
}

/** Full-screen overlay that shows the Lagos map with the detected route. */
export default function MapPanel({ open, onClose, route }: Props) {
  if (!open) return null;

  return (
    <div
      className="map-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Route map"
    >
      <header className="map-head">
        <div className="map-title">
          <strong>Route map</strong>
          <span className="sub">
            {route.length > 1
              ? `${route[0]} → ${route[route.length - 1]}`
              : route.length === 1
              ? route[0]
              : "All Lagos stops"}
          </span>
        </div>
        <button className="close" onClick={onClose} aria-label="Close map">
          ✕
        </button>
      </header>

      <div className="map-body">
        <RouteMap route={route} />
      </div>

      <p className="map-foot">
        Tap a stop for its name. Route highlighted from your conversation ·
        &copy; OpenStreetMap
      </p>

      <style jsx>{`
        .map-overlay {
          position: fixed;
          inset: 0;
          z-index: 40;
          display: flex;
          flex-direction: column;
          background: var(--bg);
        }
        .map-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 3px solid var(--header-border);
          background: var(--header-bg);
        }
        .map-title {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .map-title strong {
          font-size: 17px;
          color: var(--header-text);
        }
        .sub {
          font-size: 12.5px;
          color: var(--header-subtext);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .close {
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border: 2px solid var(--header-border);
          border-radius: 10px;
          background: transparent;
          color: var(--header-text);
          font-size: 16px;
          cursor: pointer;
        }
        .close:hover {
          background: rgba(0, 0, 0, 0.08);
        }
        .map-body {
          flex: 1;
          min-height: 0;
        }
        .map-foot {
          margin: 0;
          padding: 8px 14px;
          font-size: 11px;
          text-align: center;
          color: var(--provenance);
          background: var(--bg);
        }
        :global(.maploading) {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-muted);
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}
