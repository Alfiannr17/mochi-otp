const fallbackWebApp = {
  initData: '',
  initDataUnsafe: {},
  HapticFeedback: {},
  ready: () => {},
  expand: () => {},
};

const WebApp = window.Telegram?.WebApp ?? fallbackWebApp;

export const getTelegramUser = () => {
  try {
    const authenticatedUser = JSON.parse(window.sessionStorage.getItem('mochi_telegram_user') || 'null');
    return authenticatedUser || WebApp.initDataUnsafe?.user || null;
  } catch {
    return WebApp.initDataUnsafe?.user || null;
  }
};

export default WebApp;
