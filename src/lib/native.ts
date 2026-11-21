import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Browser } from '@capacitor/browser';

const isNative = Capacitor.isNativePlatform();

export async function tap(): Promise<void> {
  if (!isNative) return;
  try { await Haptics.impact({ style: ImpactStyle.Light }); } catch { /* ignore */ }
}

export async function success(): Promise<void> {
  if (!isNative) return;
  try { await Haptics.notification({ type: NotificationType.Success }); } catch { /* ignore */ }
}

export async function notifyLocal(title: string, body: string): Promise<void> {
  try {
    if (isNative) {
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') return;
      await LocalNotifications.schedule({
        notifications: [{ id: Math.floor(Date.now() % 2147483000), title, body }]
      });
    } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch { /* ignore */ }
}

export async function openExternal(url: string): Promise<void> {
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    if (isNative) await Browser.open({ url: full });
    else window.open(full, '_blank', 'noopener,noreferrer');
  } catch {
    window.open(full, '_blank', 'noopener,noreferrer');
  }
}
