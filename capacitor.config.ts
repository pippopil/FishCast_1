import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.fishcast.app',
  appName: 'Клёвый прогноз',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      'api.open-meteo.com',
      'flood-api.open-meteo.com',
      'tile.openstreetmap.org',
      '*.tile.openstreetmap.org',
      'photon.komoot.io',
      'nominatim.openstreetmap.org',
    ],
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#052742',
  },
};

export default config;
