import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { LoginResponse, User } from './types';

/**
 * Session state. The JWT is held in React state ONLY — SPEC §2 requires that a
 * reload returns to the login screen, so nothing is written to localStorage,
 * sessionStorage or cookies anywhere in this file (or the app).
 */
interface AuthState {
  token: string | null;
  user: User | null;
  expiresAt: string | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const res = await api<LoginResponse>('/api/auth/login', { method: 'POST', body: { email, password } });
    setToken(res.token);
    setUser(res.user);
    setExpiresAt(res.expiresAt);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    const t = token;
    setToken(null);
    setUser(null);
    setExpiresAt(null);
    if (t) void api('/api/auth/logout', { method: 'POST', token: t }).catch(() => undefined);
  }, [token]);

  const can = useCallback((permission: string) => Boolean(user?.permissions?.includes(permission)), [user]);

  const value = useMemo<AuthState>(() => ({ token, user, expiresAt, login, logout, can }), [token, user, expiresAt, login, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
