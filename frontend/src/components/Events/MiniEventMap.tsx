import React, { useEffect, useRef, useState, useCallback } from 'react';
import '../../utils/leafletInit';
// Leaflet инициализирован в leafletInit и доступен как глобальная переменная `L`
declare const L: any;

interface MiniEventMapProps {
  height?: string;
  center?: [number, number];
  zoom?: number;
  markerPosition?: [number, number] | null;
  onMarkerPositionChange?: (position: [number, number]) => void;
  onMapClick?: (position: [number, number]) => void;
  className?: string;
}

const MiniEventMap: React.FC<MiniEventMapProps> = ({
  height = '250px',
  center = [55.7558, 37.6176], // Москва по умолчанию
  zoom = 10,
  markerPosition,
  onMarkerPositionChange,
  onMapClick,
  className = '',
}) => {
  // NOTE: mapRef is a DOM container for the small map — prefer facade API for map operations when possible.
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any | null>(null);
  const markerRef = useRef<any | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Инициализация карты
    const map = L.map(mapRef.current, {
      center,
      zoom,
      zoomControl: true,
      attributionControl: false,
    });

    // Добавляем тайлы OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    // Обработчик клика на карту
    map.on('click', (e: L.LeafletMouseEvent) => {
      const position: [number, number] = [e.latlng.lat, e.latlng.lng];
      
      // Обновляем позицию маркера
      if (markerRef.current) {
        markerRef.current.setLatLng(e.latlng);
      } else {
        // Создаем новый маркер
        const marker = L.marker(e.latlng, {
          draggable: true,
        }).addTo(map);
        
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          const newPosition: [number, number] = [pos.lat, pos.lng];
          onMarkerPositionChange?.(newPosition);
        });
        
        markerRef.current = marker;
      }
      
      onMarkerPositionChange?.(position);
      onMapClick?.(position);
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Обновление позиции маркера при изменении пропса
  useEffect(() => {
    if (!mapInstanceRef.current || !markerPosition) return;

    const [lat, lng] = markerPosition;
    const latlng = L.latLng(lat, lng);

    if (markerRef.current) {
      markerRef.current.setLatLng(latlng);
    } else {
      const marker = L.marker(latlng, {
        draggable: true,
      }).addTo(mapInstanceRef.current);
      
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        const newPosition: [number, number] = [pos.lat, pos.lng];
        onMarkerPositionChange?.(newPosition);
      });
      
      markerRef.current = marker;
    }

    // Центрируем карту на маркере
    mapInstanceRef.current.setView(latlng, Math.max(mapInstanceRef.current.getZoom(), 13));
  }, [markerPosition, onMarkerPositionChange]);

  // Обновление центра карты
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setView(center, zoom);
  }, [center, zoom]);

  return (
    <div 
      className={`mini-event-map ${className}`}
      style={{ 
        width: '100%', 
        height,
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid rgba(0, 0, 0, 0.1)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
      }}
      ref={mapRef}
    />
  );
};

export default MiniEventMap;

