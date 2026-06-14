import { createContext, useContext } from 'react';

export const MochiDialogContext = createContext(null);

export const useMochiDialog = () => {
  const context = useContext(MochiDialogContext);
  if (!context) throw new Error('useMochiDialog harus dipakai di dalam MochiDialogProvider');
  return context;
};
