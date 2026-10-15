import React, { createContext, useContext, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '../types';
import api from '../api/client';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem('bi_user') || 'null'); } catch { return null; }
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('bi_token'));

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    qc.clear();
    localStorage.setItem('bi_token', data.access_token);
    localStorage.setItem('bi_user', JSON.stringify(data.user));
    setToken(data.access_token);
    setUser(data.user);
  }, [qc]);

  const loginWithToken = useCallback((accessToken: string, userData: User) => {
    qc.clear();
    localStorage.setItem('bi_token', accessToken);
    localStorage.setItem('bi_user', JSON.stringify(userData));
    setToken(accessToken);
    setUser(userData);
  }, [qc]);

  const logout = useCallback(() => {
    qc.clear();
    localStorage.removeItem('bi_token');
    localStorage.removeItem('bi_user');
    setToken(null);
    setUser(null);
  }, [qc]);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...patch };
      localStorage.setItem('bi_user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, loginWithToken, logout, updateUser, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
