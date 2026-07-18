"use client";

import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LAGOS_STOPS, LAGOS_CENTER, type LatLng } from "../lib/lagos-stops";

interface Props {
  /** Ordered stops of the route to highlight (may be empty). */
  route: string[];
}

/** Pans/zooms the map to fit the highlighted route whenever it changes. */
function FitRoute({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) {
      map.setView(points[0], 13);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    }
  }, [map, points]);
  return null;
}

export default function RouteMap({ route }: Props) {
  const routePoints = route
    .map((name) => LAGOS_STOPS[name])
    .filter(Boolean) as LatLng[];
  const routeSet = new Set(route);

  return (
    <MapContainer
      center={LAGOS_CENTER}
      zoom={11}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* The route line. */}
      {routePoints.length > 1 && (
        <Polyline
          positions={routePoints}
          pathOptions={{ color: "#0050b3", weight: 5, opacity: 0.85 }}
        />
      )}

      {/* All stops; highlighted ones sit on the current route. */}
      {Object.entries(LAGOS_STOPS).map(([name, pos]) => {
        const onRoute = routeSet.has(name);
        return (
          <CircleMarker
            key={name}
            center={pos}
            radius={onRoute ? 9 : 5}
            pathOptions={{
              color: onRoute ? "#111" : "#0050b3",
              weight: onRoute ? 2 : 1,
              fillColor: onRoute ? "#ffd400" : "#0050b3",
              fillOpacity: onRoute ? 1 : 0.55,
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -6]}
              permanent={onRoute && routePoints.length <= 6}
            >
              {name}
            </Tooltip>
          </CircleMarker>
        );
      })}

      <FitRoute points={routePoints} />
    </MapContainer>
  );
}
