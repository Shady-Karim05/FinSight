import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiService } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('finsight_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('finsight_token'));
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState('login'); // 'login' | 'register'
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Validate stored token on mount
  useEffect(() => {
    const checkAuth = async () => {
      const storedToken = localStorage.getItem('finsight_token');
      if (storedToken) {
        try {
          const profile = await apiService.getMe();
          setUser(profile);
          localStorage.setItem('finsight_user', JSON.stringify(profile));
        } catch (err) {
          console.warn('Session expired or invalid, signing out:', err);
          logout();
        }
      }
      setLoadingInitial(false);
    };
    checkAuth();
  }, []);

  const login = async (usernameOrEmail, password) => {
    const data = await apiService.login(usernameOrEmail, password);
    setToken(data.access_token);
    setUser(data.user);
    localStorage.setItem('finsight_token', data.access_token);
    localStorage.setItem('finsight_user', JSON.stringify(data.user));
    setIsAuthModalOpen(false);
    return data;
  };

  const register = async (email, username, password) => {
    const data = await apiService.register(email, username, password);
    setToken(data.access_token);
    setUser(data.user);
    localStorage.setItem('finsight_token', data.access_token);
    localStorage.setItem('finsight_user', JSON.stringify(data.user));
    setIsAuthModalOpen(false);
    return data;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('finsight_token');
    localStorage.removeItem('finsight_user');
  };

  const openAuthModal = (tab = 'login') => {
    setAuthModalTab(tab);
    setIsAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setIsAuthModalOpen(false);
  };

  const updateWatchlistCount = (delta) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, watchlist_count: Math.max(0, (prev.watchlist_count || 0) + delta) };
      localStorage.setItem('finsight_user', JSON.stringify(updated));
      return updated;
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!token,
        loadingInitial,
        isAuthModalOpen,
        authModalTab,
        setAuthModalTab,
        openAuthModal,
        closeAuthModal,
        login,
        register,
        logout,
        updateWatchlistCount
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
