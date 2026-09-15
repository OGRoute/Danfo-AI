"use client";

import { formatMinutes, formatNaira, type TripPlan } from "../lib/route-planner";

export const MODE_ICON: Record<string, string> = {
  danfo: "🚐",
  brt: "🚌",
  rail: "🚆",
  ferry: "⛴️",
  keke: "🛺",
};

const MODE_NAME: Record<string, string> = {
  danfo: "Danfo",
  brt: "BRT",
  rail: "Train",
  ferry: "Ferry",
  keke: "Keke",
};

/**
 * The computed trip behind a reply: every leg with its boarding point, drop-off
 * and fare, straight from the route database (the same plan the model was
 * given), plus a shortcut to follow it on the live map.
 */
export default function TripCard({ plan, onShowMap }: { plan: TripPlan; onShowMap: () => void }) {
  const best = plan.best;
  if (!best) return null;
  const estimated = best.legs.some((l) => l.estimated);

  return (
    <div className="trip">
      <div className="trip-head">
        <strong>
          {best.from} → {best.to}
        </strong>
        <span className="trip-total">{formatNaira(best.fare)}</span>
      </div>
      <div className="trip-sub">
        {best.legs.length === 1 ? "1 vehicle" : `${best.legs.length} vehicles`}
        {best.duration && ` · ~${formatMinutes(best.duration)}`}
        {plan.originSource === "location" && " · from the stop nearest you"}
      </div>

      <ol className="legs">
        {best.legs.map((leg, i) => (
          <li key={i} className="leg">
            <span className="leg-icon" aria-hidden>
              {MODE_ICON[leg.mode] ?? "🚏"}
            </span>
            <div className="leg-body">
              <div className="leg-title">
                <span>
                  {i + 1}. {MODE_NAME[leg.mode] ?? leg.mode}
                  {leg.line ? ` · ${leg.line}` : ""}
                </span>
                <span className="leg-fare">
                  {formatNaira(leg.fare)}
                  {leg.estimated ? "*" : ""}
                </span>
              </div>
              <div className="leg-line">
                <span className="k">Board</span> {leg.board}
              </div>
              <div className="leg-line">
                <span className="k">Get off</span> {leg.alight}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {plan.substitutions.map((s) => (
        <div key={s.requested} className="trip-note">
          {s.requested} isn&apos;t on a mapped route — nearest served stop is {s.used} (~{s.km} km).
        </div>
      ))}

      {plan.alternatives.length > 0 && (
        <div className="alts">
          {plan.alternatives.map((alt, i) => (
            <div key={i} className="alt">
              <span>
                Option {i + 2}: {alt.legs.map((l) => MODE_ICON[l.mode] ?? l.mode).join(" → ")}
              </span>
              <span>
                {formatNaira(alt.fare)}
                {alt.duration ? ` · ~${formatMinutes(alt.duration)}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="trip-foot">
        <span className="est">{estimated ? "* estimated for part of a line" : "Fares are approximate"}</span>
        <button type="button" className="trip-map" onClick={onShowMap}>
          🗺️ Live map
        </button>
      </div>

      <style jsx>{`
        .trip {
          margin-top: 10px;
          border: 2px solid var(--border);
          border-radius: 12px;
          background: var(--bg);
          padding: 10px 12px;
          font-size: 13.5px;
        }
        .trip-head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
        }
        .trip-total {
          font-weight: 800;
          white-space: nowrap;
        }
        .trip-sub {
          color: var(--text-muted);
          font-size: 12px;
          margin-top: 2px;
        }
        .legs {
          list-style: none;
          margin: 10px 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .leg {
          display: flex;
          gap: 10px;
        }
        .leg-icon {
          font-size: 18px;
          line-height: 1.2;
        }
        .leg-body {
          flex: 1;
          min-width: 0;
        }
        .leg-title {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          font-weight: 700;
        }
        .leg-fare {
          white-space: nowrap;
        }
        .leg-line {
          line-height: 1.4;
          margin-top: 2px;
        }
        .k {
          display: inline-block;
          min-width: 52px;
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-muted);
        }
        .trip-note {
          margin-top: 8px;
          font-size: 12px;
          color: var(--verify-warn);
        }
        .alts {
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px dashed var(--border);
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12.5px;
        }
        .alt {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }
        .trip-foot {
          margin-top: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .est {
          font-size: 11px;
          color: var(--text-muted);
        }
        .trip-map {
          border: 2px solid var(--border);
          border-radius: 999px;
          background: var(--accent);
          color: var(--accent-text);
          font-weight: 700;
          font-size: 12.5px;
          padding: 5px 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .trip-map:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--ring);
        }
      `}</style>
    </div>
  );
}
