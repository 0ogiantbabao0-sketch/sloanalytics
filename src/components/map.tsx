"use client";
import { useEffect, useRef, useState } from "react";
import type { Hall } from "@/lib/types";
import L from "leaflet";
export default function HallMap({
  halls,
  center,
  radius,
  onCenter,
  selected,
  onSelect,
}: {
  halls: Hall[];
  center: { lat: number; lng: number };
  radius: number;
  onCenter?: (lat: number, lng: number) => void;
  selected?: string;
  onSelect?: (id: string) => void;
}) {
  const [tileError, setTileError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const viewportKey = useRef("");
  useEffect(() => {
    if (!ref.current) return;
    map.current = L.map(ref.current, { scrollWheelZoom: false }).setView(
      [center.lat, center.lng],
      10,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    })
      .on("tileerror", () => setTileError(true))
      .addTo(map.current);
    layers.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
      viewportKey.current = "";
    };
  }, []); // eslint-disable-line
  useEffect(() => {
    const m = map.current,
      group = layers.current;
    if (!m || !group) return;
    group.clearLayers();
    const circle = L.circle([center.lat, center.lng], {
      radius: radius * 1000,
      color: "#3674ee",
      weight: 1.5,
      fillOpacity: 0.055,
      dashArray: "5 5",
    }).addTo(group);
    L.circleMarker([center.lat, center.lng], {
      radius: 6,
      color: "#fff",
      weight: 3,
      fillColor: "#2c6ee8",
      fillOpacity: 1,
    })
      .addTo(group)
      .bindTooltip("検索中心地");
    for (const [i, h] of halls.entries()) {
      const marker = L.marker([h.lat, h.lng], {
        icon: L.divIcon({
          className: "map-pin",
          html: `<span class="${selected === h.id ? "selected" : ""}">${i + 1}</span>`,
          iconSize: [30, 36],
          iconAnchor: [15, 36],
        }),
      }).addTo(group);
      const node = document.createElement("span");
      node.textContent = h.name;
      marker.bindTooltip(node);
      marker.on("click", () => onSelect?.(h.id));
    }
    const nextViewport = `${center.lat}/${center.lng}/${radius}`;
    if (viewportKey.current !== nextViewport) {
      m.fitBounds(circle.getBounds(), { padding: [12, 12], maxZoom: 12 });
      viewportKey.current = nextViewport;
    }
    const listener = (e: L.LeafletMouseEvent) =>
      onCenter?.(e.latlng.lat, e.latlng.lng);
    m.on("click", listener);
    return () => {
      m.off("click", listener);
    };
  }, [halls, center.lat, center.lng, radius, selected, onCenter, onSelect]);
  return (
    <div className="map-wrapper">
      {tileError && (
        <p className="map-error" role="status">
          背景地図を取得できません。地点と検索範囲のみ表示しています。
        </p>
      )}
      <div
        className="map-canvas"
        ref={ref}
        aria-label="ホール地図。クリックで検索中心地を指定"
      />
    </div>
  );
}
