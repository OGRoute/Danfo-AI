"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  isInLagosArea,
  nearestPlaces,
  placeSubtitle,
  searchPlaces,
  type PickerPlace,
} from "../lib/lagos-places";
import type { LatLng } from "../lib/lagos-stops";

/** One end of a trip, as sent to /api/chat. */
export type TripEndpoint =
  | { id: string }
  | { location: LatLng; accuracy?: number };

export interface PickedTrip {
  origin: TripEndpoint;
  destination: TripEndpoint;
  /** Readable form for the chat bubble: "From Allen Avenue to Ajah". */
  text: string;
}

/** A fix vaguer than this can't say which bus stop the rider is near. */
const COARSE_M = 500;

type Choice =
  | { type: "place"; place: PickerPlace }
  | { type: "here"; pos: LatLng; accuracy?: number; near?: string };

interface FieldProps {
  label: string;
  placeholder: string;
  value: Choice | null;
  onChange: (c: Choice | null) => void;
  /** Offer "Use my current location" (the From field). */
  allowHere?: boolean;
  /** Last known position, to rank nearby places first. */
  near?: LatLng | null;
  /** Never offer the place already picked at the other end. */
  exclude?: string;
  onLocated?: (pos: LatLng, accuracy?: number) => void;
  disabled?: boolean;
}

const choiceText = (c: Choice | null) =>
  !c ? "" : c.type === "place" ? c.place.name : c.near ? `My location · near ${c.near}` : "My location";

function PlaceField({
  label,
  placeholder,
  value,
  onChange,
  allowHere,
  near,
  exclude,
  onLocated,
  disabled,
}: FieldProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState("");
  /** Nearby places offered when the fix was too vague to use directly. */
  const [nearby, setNearby] = useState<PickerPlace[]>([]);

  // While a choice is held the box shows it; typing replaces it.
  const text = value ? choiceText(value) : query;

  const results = useMemo(
    () => (open ? searchPlaces(value ? "" : query, 8, near).filter((p) => p.id !== exclude) : []),
    [open, query, value, near, exclude]
  );
  const showHere = !!allowHere && !(value ? "" : query).trim();
  const rows = (showHere ? 1 : 0) + results.length;

  useEffect(() => setActive(0), [query, open]);

  function pick(place: PickerPlace) {
    onChange({ type: "place", place });
    setQuery("");
    setNotice("");
    setNearby([]);
    setOpen(false);
  }

  function locateMe() {
    setOpen(false);
    setNotice("");
    setNearby([]);
    if (!("geolocation" in navigator)) {
      setNotice("This device can't share its location — pick your starting point instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        setLocating(false);
        const pos: LatLng = [fix.coords.latitude, fix.coords.longitude];
        const accuracy = fix.coords.accuracy;
        if (!isInLagosArea(pos)) {
          setNotice("You don't seem to be in Lagos right now — pick a starting point in Lagos instead.");
          return;
        }
        onLocated?.(pos, accuracy);
        const around = nearestPlaces(pos, 4);
        if (accuracy > COARSE_M) {
          // Don't start a trip from a guess: let the rider say which it is.
          setNearby(around);
          setNotice(
            `Your location is only accurate to about ${
              accuracy >= 1000 ? `${(accuracy / 1000).toFixed(1)} km` : `${Math.round(accuracy / 50) * 50} m`
            }${around.length ? " — which of these are you at?" : " — type where you are instead."}`
          );
          return;
        }
        setQuery("");
        onChange({ type: "here", pos, accuracy, near: around[0]?.name });
      },
      (err) => {
        setLocating(false);
        setNotice(
          err.code === err.PERMISSION_DENIED
            ? "Location is switched off for this site — allow it in your browser, or pick your starting point."
            : "Couldn't get your location — pick your starting point instead."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (rows) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : rows - 1)) % rows);
    } else if (e.key === "Enter" && open && rows) {
      e.preventDefault();
      if (showHere && active === 0) locateMe();
      else pick(results[active - (showHere ? 1 : 0)]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor={`${listId}-input`}>{label}</label>
      <div className="box">
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={locating ? "Finding you…" : placeholder}
          value={text}
          disabled={disabled || locating}
          onChange={(e) => {
            if (value) onChange(null);
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={(e) => {
            // Coming straight back (the clear button) must not let the pending
            // blur close the list again.
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setOpen(true);
            if (value) e.target.select();
          }}
          // Delay so a tap on an option lands before the list closes.
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={onKeyDown}
        />
        {(value || query) && !disabled && !locating && (
          <button
            type="button"
            className="clear"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              onChange(null);
              setQuery("");
              setNotice("");
              setNearby([]);
              inputRef.current?.focus();
            }}
          >
            ✕
          </button>
        )}
        {open && rows > 0 && (
          <ul className="list" id={listId} role="listbox" aria-label={`${label} suggestions`}>
            {showHere && (
              <li
                id={`${listId}-0`}
                role="option"
                aria-selected={active === 0}
                className={`opt here ${active === 0 ? "on" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={locateMe}
              >
                <span className="name">
                  <span aria-hidden>📍</span> Use my current location
                </span>
              </li>
            )}
            {results.map((p, i) => {
              const n = i + (showHere ? 1 : 0);
              return (
                <li
                  key={p.id}
                  id={`${listId}-${n}`}
                  role="option"
                  aria-selected={active === n}
                  className={`opt ${active === n ? "on" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                >
                  <span className="name">{p.name}</span>
                  <span className="sub">{placeSubtitle(p)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {open && rows === 0 && query.trim().length >= 2 && (
          <div className="list none" role="status">
            No Lagos place by that name yet — try a nearby area or bus stop.
          </div>
        )}
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {nearby.length > 0 && (
        <div className="chips">
          {nearby.map((p) => (
            <button key={p.id} type="button" className="chip" onClick={() => pick(p)}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <style jsx>{`
        .field {
          flex: 1 1 0;
          min-width: 0;
        }
        label {
          display: block;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin: 0 0 4px 2px;
        }
        .box {
          position: relative;
        }
        input {
          width: 100%;
          height: 46px;
          padding: 0 36px 0 12px;
          border: 2px solid var(--border);
          border-radius: 12px;
          font: inherit;
          font-size: 16px; /* >=16px stops iOS Safari zooming on focus */
          background: var(--surface);
          color: var(--text);
          outline: none;
          text-overflow: ellipsis;
        }
        input::placeholder {
          color: var(--text-muted);
          opacity: 0.8;
        }
        input:focus {
          box-shadow: 0 0 0 3px var(--ring);
        }
        input:disabled {
          opacity: 0.65;
        }
        .clear {
          position: absolute;
          top: 7px;
          right: 6px;
          width: 32px;
          height: 32px;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: var(--text-muted);
          font-size: 13px;
          cursor: pointer;
        }
        .clear:hover {
          background: var(--surface-hover);
        }
        .list {
          position: absolute;
          z-index: 30;
          left: 0;
          right: 0;
          bottom: calc(100% + 6px);
          margin: 0;
          padding: 4px;
          list-style: none;
          max-height: min(300px, 45dvh);
          overflow-y: auto;
          background: var(--surface);
          border: 2px solid var(--border);
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        }
        .list.none {
          padding: 12px;
          font-size: 13px;
          color: var(--text-muted);
        }
        .opt {
          display: flex;
          flex-direction: column;
          gap: 1px;
          padding: 9px 10px;
          border-radius: 8px;
          cursor: pointer;
        }
        .opt.on,
        .opt:hover {
          background: var(--surface-hover);
        }
        .opt.here .name {
          font-weight: 800;
        }
        .name {
          font-size: 15px;
          font-weight: 600;
          color: var(--text);
          overflow-wrap: anywhere;
        }
        .sub {
          font-size: 12px;
          color: var(--text-muted);
        }
        .notice {
          margin-top: 6px;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-muted);
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 6px;
        }
        .chip {
          padding: 6px 10px;
          border: 2px solid var(--border);
          border-radius: 999px;
          background: var(--surface);
          color: var(--text);
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .chip:hover {
          background: var(--surface-hover);
        }
      `}</style>
    </div>
  );
}

interface Props {
  /** Called with the chosen trip when the rider taps "Get route". */
  onSubmit: (trip: PickedTrip) => void;
  /** A request is in flight. */
  busy?: boolean;
  /** Position already known from the live map, to rank nearby places first. */
  position?: LatLng | null;
  onLocated?: (pos: LatLng, accuracy?: number) => void;
}

/**
 * From / To picker: choose a start (or "my current location") and a
 * destination from every Lagos place DanfoAI knows, and get the route between
 * exactly those two points.
 */
export default function TripPicker({ onSubmit, busy, position, onLocated }: Props) {
  const [origin, setOrigin] = useState<Choice | null>(null);
  const [destination, setDestination] = useState<Choice | null>(null);
  const [near, setNear] = useState<LatLng | null>(position ?? null);

  useEffect(() => {
    if (position) setNear(position);
  }, [position]);

  const endpoint = (c: Choice): TripEndpoint =>
    c.type === "place" ? { id: c.place.id } : { location: c.pos, accuracy: c.accuracy };
  const spoken = (c: Choice) => (c.type === "place" ? c.place.name : "my location");
  const idOf = (c: Choice | null) => (c?.type === "place" ? c.place.id : undefined);

  const same = !!origin && !!destination && idOf(origin) !== undefined && idOf(origin) === idOf(destination);
  const ready = !!origin && !!destination && !same && !busy;

  function submit() {
    if (!origin || !destination || !ready) return;
    onSubmit({
      origin: endpoint(origin),
      destination: endpoint(destination),
      text: `From ${spoken(origin)} to ${spoken(destination)}`,
    });
  }

  function swap() {
    // "My location" only makes sense as a start, so it is dropped on a swap.
    setOrigin(destination);
    setDestination(origin?.type === "place" ? origin : null);
  }

  return (
    <form
      className="picker"
      aria-label="Choose your start and destination"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="row">
        <PlaceField
          label="From"
          placeholder="Where are you? Area, bus stop, landmark"
          value={origin}
          onChange={setOrigin}
          allowHere
          near={near}
          exclude={idOf(destination)}
          onLocated={(pos, accuracy) => {
            setNear(pos);
            onLocated?.(pos, accuracy);
          }}
          disabled={busy}
        />
        <button
          type="button"
          className="swap"
          onClick={swap}
          disabled={busy || (!origin && !destination)}
          aria-label="Swap start and destination"
          title="Swap"
        >
          ⇄
        </button>
        <PlaceField
          label="To"
          placeholder="Where are you going?"
          value={destination}
          onChange={setDestination}
          near={null}
          exclude={idOf(origin)}
          disabled={busy}
        />
        <button type="submit" className="route" disabled={!ready}>
          Get route
        </button>
      </div>

      <style jsx>{`
        .picker {
          padding: 12px 16px 2px;
          border-top: 3px solid var(--header-border);
          background: color-mix(in srgb, var(--bg) 86%, transparent);
        }
        .row {
          display: flex;
          align-items: flex-end;
          gap: 8px;
        }
        .swap,
        .route {
          height: 46px;
          flex-shrink: 0;
          border: 2px solid var(--border);
          border-radius: 12px;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
        }
        .swap {
          width: 42px;
          background: var(--surface);
          color: var(--text);
          font-size: 17px;
        }
        .route {
          padding: 0 14px;
          background: var(--accent);
          color: var(--accent-text);
          font-size: 15px;
          white-space: nowrap;
        }
        .swap:disabled,
        .route:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .swap:focus-visible,
        .route:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px var(--ring);
        }
        @media (max-width: 600px) {
          .picker {
            padding: 10px 12px 2px;
          }
          .row {
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
          }
          .swap {
            align-self: flex-end;
            width: 46px;
            height: 32px;
            font-size: 15px;
          }
          .route {
            margin-top: 4px;
          }
        }
      `}</style>
    </form>
  );
}
