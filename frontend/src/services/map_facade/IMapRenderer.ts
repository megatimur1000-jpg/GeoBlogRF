// ========================
// Базовые гео-типы
// ========================

export interface GeoPoint {
  lat: number;
  lon: number;
}

export type LatLng = [number, number]; // [lat, lng] — как в Leaflet

export type Bounds = {
  north?: number;
  south?: number;
  east?: number;
  west?: number;
  // Альтернативный формат (например, для Leaflet)
  southWest?: LatLng;
  northEast?: LatLng;
};

// ========================
// Контекст и конфигурация
// ========================

export type MapContext = 'osm' | 'planner' | 'offline';

export interface MapConfig {
  center?: GeoPoint | LatLng;
  zoom?: number;
  markers?: UnifiedMarker[];
  // Дополнительные параметры, специфичные для провайдера
  [key: string]: unknown;
}

// ========================
// Маркеры и события
// ========================

export interface UnifiedMarker {
  id: string;
  name?: string;
  coordinates: GeoPoint;
  type?: string; // 'post', 'event', 'poi'
  shape?: string; // 'drop', 'circle'
  color?: string;
  icon?: string; // имя иконки или URL
  size?: 'small' | 'medium' | 'large';
  popupContent?: unknown;

  // Расширенные поля для UI
  title?: string;
  description?: string;
  category?: string;
  iconSize?: [number, number];
  routeMarker?: string;
}

export interface CalendarEvent {
  id: string;
  title?: string;
  location?: { coordinates: GeoPoint };
  category?: string;
  startAt?: string | Date;
  [key: string]: unknown;
}

// ========================
// Маршруты
// ========================

export interface PersistedRoute {
  id: string;
  waypoints: GeoPoint[];
  geometry?: unknown; // GeoJSON LineString или аналог
  distance?: number; // метры
  duration?: number; // миллисекунды
  createdAt?: Date;
}

export interface TrackedRoute extends PersistedRoute {
  points: GeoPoint[]; // полный трек с частотой записи
  startTime: Date;
  endTime: Date;
  metadata?: Record<string, unknown>;
  bbox?: Bounds | null;
}

// ========================
// Отдельные интерфейсы для внешнего использования (например, фасада)
// ========================

export interface MapMarker {
  id: string;
  position: GeoPoint;
  title?: string;
  category?: string;
  type?: string;
  // Добавь остальные поля, если они нужны, например: icon, popup и т.д.
}

export interface Route {
  id: string;
  points: GeoPoint[];
  distance: number;
  duration: number;
  // ... остальные поля
}

// ========================
// Черновики и избранное
// ========================

// TODO: заменить на конкретные типы при рефакторинге
export type DraftPost = unknown;
export type DraftMarker = unknown;
export type DraftRoute = unknown;
export type DraftEvent = unknown;
export type FavoriteItem = unknown;

// ========================
// Вспомогательные типы
// ========================

export interface MapActionButton {
  id: string;
  icon: string;
  tooltip?: string;
  badge?: number;
  active?: boolean;
}

export type DateRange = { from: Date; to: Date };

export interface RouteStats {
  distance: number; // метры
  duration: number; // миллисекунды
  [key: string]: unknown;
}

// ========================
// Зависимости фасада
// ========================

export interface MapFacadeDependencies {
  accessControlService: { isPremium: () => boolean };
  storageService: {
    getDownloadedRegions: () => string[];
    addToFavorites?: (item: unknown) => void;
    getFavorites?: () => unknown[];
    removeFromFavorites?: (id: string) => void;
    saveRoute?: (route: PersistedRoute) => void;
    downloadRegion?: (id: string) => Promise<void>;
    deleteRegion?: (id: string) => Promise<void>;
  };
  notificationService?: {
    notify?: (opts: { type?: string; title?: string; message?: string }) => void;
  };
  userService?: { getCurrentUser?: () => { id?: string } };
  offlineContentQueue: {
    saveDraft?: (type: string, draft: unknown) => Promise<void>;
    syncPosts?: () => Promise<void>;
    getDrafts?: (type?: string) => Promise<unknown[]>;
    syncAll?: () => Promise<void>;
  };
  moderationService: { submitPost?: (draft: unknown) => Promise<void> };
  eventsStore: { getEvents?: (range: DateRange) => Promise<CalendarEvent[]> };
  gamificationFacade: {
    recordAction?: (action: string, meta?: unknown) => Promise<void>;
    isActionRateLimited?: (action: string) => boolean;
  };
  activityService: { recordActivity?: (activity: unknown) => void };
  analyticsOrchestrator: {
    trackMapInteraction?: (event: MapAnalyticsEvent) => void;
  };
}

export type MapAnalyticsEvent = {
  action: string;
} & Record<string, unknown>;

// ========================
// Интерфейс рендерера карты
// ========================

export interface IMapRenderer {
  // Инициализация
  init(containerId: string, config?: MapConfig): Promise<void>;
  destroy(): void;

  // Управление видом
  setView(center: GeoPoint, zoom: number): void;
  invalidateSize?(): void;

  // Рендеринг данных
  renderMarkers(markers: UnifiedMarker[]): void;
  renderRoute(route: PersistedRoute): void;

  // Очистка (опционально)
  clear?(): void;
  removeMarker?(id: string): void;
  removeRoute?(id: string): void;

  // Доступ к инстансу (для расширенных сценариев)
  getMap?(): unknown;

  // --- Доп. утилиты (опциональные) для упрощения работы компонентов через фасад ---
  // Только общие методы, не завязанные на конкретной реализации карты
  addTileLayer?(url: string, options?: any): any;

  // Обработка событий
  onMapClick?(handler: (event: any) => void): void;
  onMapMove?(handler: () => void): void;
  onMapZoom?(handler: () => void): void;
}