import { useCallback, useMemo, useState } from 'react';
import { MochiDialogContext } from '../hooks/useMochiDialog';

export function MochiDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const closeDialog = useCallback((result = false) => {
    setDialog((current) => {
      current?.resolve?.(result);
      return null;
    });
  }, []);

  const alert = useCallback((message, options = {}) => new Promise((resolve) => {
    setDialog({
      type: options.type || 'info',
      title: options.title || 'MOCHI OTP',
      message,
      confirmText: options.confirmText || 'OK',
      resolve,
    });
  }), []);

  const confirm = useCallback((message, options = {}) => new Promise((resolve) => {
    setDialog({
      type: options.type || 'confirm',
      title: options.title || 'Konfirmasi',
      message,
      confirmText: options.confirmText || 'Lanjutkan',
      cancelText: options.cancelText || 'Batal',
      resolve,
    });
  }), []);

  const value = useMemo(() => ({ alert, confirm }), [alert, confirm]);

  return (
    <MochiDialogContext.Provider value={value}>
      {children}

      {dialog && (
        <div className="fixed inset-0 z-[100] bg-black/55 p-5 flex items-center justify-center">
          <div className="w-full max-w-sm border-2 border-black rounded-2xl bg-mochi-bg p-5 shadow-neo">
            <div className={`w-14 h-14 border-2 border-black rounded-full flex items-center justify-center text-2xl font-black mb-4 ${
              dialog.type === 'error' ? 'bg-red-300' : 'bg-mochi-green'
            }`}>
              {dialog.type === 'error' ? '!' : '?'}
            </div>
            <h2 className="text-xl font-black mb-2">{dialog.title}</h2>
            <p className="text-sm font-bold whitespace-pre-line mb-6">{dialog.message}</p>

            <div className={`grid gap-3 ${dialog.type === 'confirm' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {dialog.type === 'confirm' && (
                <button
                  type="button"
                  onClick={() => closeDialog(false)}
                  className="border-2 border-black rounded-xl bg-white py-3 font-black shadow-neo active:translate-y-1 active:shadow-none"
                >
                  {dialog.cancelText}
                </button>
              )}
              <button
                type="button"
                onClick={() => closeDialog(true)}
                className="border-2 border-black rounded-xl bg-mochi-green py-3 font-black shadow-neo active:translate-y-1 active:shadow-none"
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </MochiDialogContext.Provider>
  );
}
