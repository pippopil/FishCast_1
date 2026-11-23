export type PWANotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function getNotificationPermissionState(): PWANotificationPermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestPWANotificationPermission(): Promise<PWANotificationPermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function sendPWABiteNotification(params: {
  title: string;
  body: string;
  tag: string;
  waterBodyId?: string;
}): Promise<'pwa' | 'in-app'> {
  const { title, body, tag, waterBodyId } = params;
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'in-app';
  }
  if (Notification.permission !== 'granted') {
    return 'in-app';
  }

  const options: NotificationOptions = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag,
    data: { waterBodyId, url: '/' },
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, options);
        return 'pwa';
      }
    }
    new Notification(title, options);
    return 'pwa';
  } catch {
    return 'in-app';
  }
}
