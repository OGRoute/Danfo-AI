"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import type { LatLng } from "../lib/lagos-stops";
import type { TripPlan } from "../lib/route-planner";

// Leaflet touches `window` on import, so the map must be client-only (no SSR).
const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="maploading">Loading map…</div>,
});

interface Props {
  open: boolean;
  onClose: () => void;
  /** Trip to show (best route + alternatives). */
  plan: TripPlan | null;
  /** Stops mentioned in chat, shown when there is no computed trip. */
  stops: string[];
  /** Live GPS position updates, so chat can plan from where the rider is. */
  onPosition?: (pos: LatLng) => void;
}

/** Full-screen live map: the planned route on real roads plus your position. */
export default function MapPanel({ open, onClose, plan, stops, onPosition }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const itineraries = plan?.best ? [plan.best, ...plan.alternatives] : [];
  const subtitle = plan?.best
    ? `${plan.best.from} → ${plan.best.to}`
    : stops.length > 1
      ? `${stops[0]} → ${stops[stops.length - 1]}`
      : stops[0] ?? "All Lagos stops";

  return (
    <div className="map-overlay" role="dialog" aria-modal="true" aria-label="Live route map">
      <header className="map-head">
        <div className="map-title">
          <strong>Live map</strong>
          <span className="sub">{subtitle}</span>
        </div>
        <button className="close" onClick={onClose} aria-label="Close map">
          ✕
        </button>
      </header>

      <div className="map-body">
        <RouteMap itineraries={itineraries} stops={stops} onPosition={onPosition} />
      </div>

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
          position: relative;
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
