import { createContext, useContext, useState, ReactNode } from 'react';

interface ThemeCtx { isDark: boolean; toggleTheme: () => void; }
const Ctx = createContext<ThemeCtx>({ isDark: false, toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() => localStorage.getItem('bi-theme') === 'dark');
  const toggleTheme = () => setIsDark(prev => {
    const next = !prev;
    localStorage.setItem('bi-theme', next ? 'dark' : 'light');
    return next;
  });
  return <Ctx.Provider value={{ isDark, toggleTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
