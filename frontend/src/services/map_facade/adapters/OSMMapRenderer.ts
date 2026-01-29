import type { IMapRenderer, MapConfig, UnifiedMarker, PersistedRoute, GeoPoint } from '../IMapRenderer';
import L from 'leaflet';

export class OSMMapRenderer implements IMapRenderer {
  private containerId: string | null = null;
  private mapInstance: L.Map | null = null;
  private leafletMarkers: Record<string, L.Marker> = {};

  // Соответствует интерфейсу IMapRenderer
  public async init(containerId: string, config?: MapConfig): Promise<void> {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Элемент с id "${containerId}" не найден`);
    }

    this.containerId = containerId;

    // Используем координаты из config или значения по умолчанию
    const center = config?.center;
    let lat: number, lon: number;

    if (Array.isArray(center)) {
      // LatLng: [lat, lng]
      lat = center[0];
      lon = center[1];
    } else if (center && typeof center === 'object') {
      // GeoPoint: { lat, lon }
      lat = center.lat;
      lon = center.lon;
    } else {
      // Москва по умолчанию
      lat = 55.7558;
      lon = 37.6176;
    }

    const zoom = config?.zoom ?? 10;

    this.mapInstance = L.map(containerId, {
      center: [lat, lon],
      zoom,
      zoomControl: true,
    });

    this.addTileLayer();

    // Небольшая задержка для корректного отображения (опционально)
    setTimeout(() => {
      this.mapInstance?.invalidateSize();
    }, 100);
  }

  private addTileLayer(): void {
    if (!this.mapInstance) return;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.mapInstance);
  }

  public getMap(): L.Map {
    if (!this.mapInstance) {
      throw new Error('Карта не инициализирована');
    }
    return this.mapInstance;
  }

  renderMarkers(markers: UnifiedMarker[]): void {
    if (!this.mapInstance) {
      console.warn('[OSMMapRenderer] Map not initialized, cannot render markers');
      return;
    }

    const newIds = new Set(markers.map(m => m.id));
    Object.keys(this.leafletMarkers).forEach(id => {
      if (!newIds.has(id)) {
        this.mapInstance!.removeLayer(this.leafletMarkers[id]);
        delete this.leafletMarkers[id];
      }
    });

    markers.forEach(marker => {
      if (!this.leafletMarkers[marker.id]) {
        const leafletMarker = L.marker([marker.coordinates.lat, marker.coordinates.lon], {
          title: marker.title || marker.name || '',
        });
        leafletMarker.addTo(this.mapInstance!);
        this.leafletMarkers[marker.id] = leafletMarker;
      }
    });

    console.log(`[OSMMapRenderer] Rendering ${markers.length} markers`);
  }

  renderRoute(route: PersistedRoute): void {
    if (!this.mapInstance) {
      console.warn('[OSMMapRenderer] Map not initialized, cannot render route');
      return;
    }
    console.log(`[OSMMapRenderer] Rendering route ${route.id}`);
    // Реализация отрисовки маршрута (полилиния и т.д.)
  }

  setView(center: GeoPoint, zoom: number): void {
    if (!this.mapInstance) {
      console.warn('[OSMMapRenderer] Map not initialized, cannot set view');
      return;
    }
    try {
      this.mapInstance.setView([center.lat, center.lon], zoom);
    } catch (e) {
      console.warn('[OSMMapRenderer] Failed to set view:', e);
    }
  }

  destroy(): void {
    if (this.mapInstance) {
      try {
        const container = this.mapInstance.getContainer();
        if (container) {
          // Удаляем возможную ссылку
          delete (container as any).__leafletMap;
        }
        this.mapInstance.remove();
        this.mapInstance = null;
        this.leafletMarkers = {};
      } catch (e) {
        console.warn('[OSMMapRenderer] Error destroying map:', e);
      }
    }
    console.log('[OSMMapRenderer] Destroyed');
  }
}