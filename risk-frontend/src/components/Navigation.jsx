import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, TrendingUp, Activity, Layers, User, LogOut, LogIn, Star } from 'lucide-react';
import Settings from './Settings';
import { useAuth } from '../context/AuthContext';

const Navigation = () => {
  const location = useLocation();
  const { user, isAuthenticated, logout, openAuthModal } = useAuth();
  const navLinks = [
    { to: '/', label: 'Dashboard', icon: BarChart3 },
    { to: '/portfolio', label: 'Portfolio', icon: Layers },
    { to: '/sentiment', label: 'Sentiment', icon: Activity },
  ];

  return (
    <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <div className="flex-shrink-0 flex items-center">
              <BarChart3 className="w-8 h-8 text-primary-600 dark:text-primary-400" />
              <span className="ml-2 text-xl font-bold text-gray-900 dark:text-white">
                FinSight
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {navLinks.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  location.pathname === to
                    ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-100'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-primary-700 dark:hover:text-primary-300'
                }`}
              >
                <Icon className="w-5 h-5 mr-1" />
                {label}
              </Link>
            ))}
            <div className="ml-2">
              <Settings />
            </div>

            {/* User Auth Section */}
            <div className="ml-3 pl-3 border-l border-gray-200 dark:border-gray-700 flex items-center space-x-2">
              {isAuthenticated ? (
                <div className="flex items-center space-x-2">
                  <div className="flex items-center px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-xs text-blue-900 dark:text-blue-300">
                    <User className="w-3.5 h-3.5 mr-1.5 text-blue-600 dark:text-blue-400" />
                    <span className="font-semibold">{user?.username}</span>
                  </div>
                  <button
                    onClick={logout}
                    title="Sign Out"
                    className="p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => openAuthModal('login')}
                  className="flex items-center px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-all"
                >
                  <LogIn className="w-3.5 h-3.5 mr-1" />
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation; 