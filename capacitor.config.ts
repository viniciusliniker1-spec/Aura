import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.auraos.personal',
  appName: 'aura',
  webDir: 'dist',
  backgroundColor: '#5c7093',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#0A57A3'
    }
  }
};

export default config;
