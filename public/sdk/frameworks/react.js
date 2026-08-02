/**
 * ASG Offline React SDK (react.js)
 * Official React & Next.js integration for ASG Offline Web Service.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['react'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('react'));
  } else {
    root.ASGOfflineReact = factory(root.React);
  }
}(typeof self !== 'undefined' ? self : this, function (React) {
  'use strict';

  if (!React) {
    console.warn('[ASG Offline React SDK] React dependency not found. Ensure React is loaded.');
    return {};
  }

  const { useState, useEffect, useContext, createContext, useMemo } = React;

  const ASGOfflineContext = createContext({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    sdk: typeof window !== 'undefined' ? window.ASGOffline : null,
    queueCount: 0,
    save: async () => {},
    find: async () => [],
    syncPost: async () => {}
  });

  /**
   * ASGOfflineProvider Component
   * Context provider to initialize and distribute ASG Offline state across React component trees.
   */
  function ASGOfflineProvider({ appId = 'demo-app', serverUrl, children }) {
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const [queueCount, setQueueCount] = useState(0);

    useEffect(() => {
      let unSubStatus = null;
      let unSubQueue = null;

      const bindSdk = () => {
        if (window.ASGOffline) {
          setIsOnline(window.ASGOffline.isOnline);
          if (window.ASGOffline.onStatusChange) unSubStatus = window.ASGOffline.onStatusChange(setIsOnline);
          if (window.ASGOffline.onQueueChange) unSubQueue = window.ASGOffline.onQueueChange((count) => setQueueCount(count));
          if (window.ASGOffline.getPOSAQueue) {
            window.ASGOffline.getPOSAQueue().then(q => setQueueCount(q ? q.length : 0));
          }
        }
      };

      if (typeof window !== 'undefined' && window.ASGOffline) {
        bindSdk();
      } else if (typeof document !== 'undefined') {
        const existing = document.querySelector('script[src*="asg-offline.js"]');
        if (!existing) {
          const script = document.createElement('script');
          script.src = (serverUrl || window.location.origin) + '/sdk/asg-offline.js';
          script.setAttribute('data-app-id', appId);
          if (serverUrl) script.setAttribute('data-server-url', serverUrl);
          script.async = true;
          script.onload = bindSdk;
          document.head.appendChild(script);
        }
      }

      return () => {
        if (typeof unSubStatus === 'function') unSubStatus();
        if (typeof unSubQueue === 'function') unSubQueue();
      };
    }, [appId, serverUrl]);

    const contextValue = useMemo(() => ({
      isOnline,
      sdk: typeof window !== 'undefined' ? window.ASGOffline : null,
      queueCount,
      save: async (collection, data) => {
        if (typeof window !== 'undefined' && window.ASGOffline) {
          return await window.ASGOffline.save(collection, data);
        }
      },
      find: async (collection) => {
        if (typeof window !== 'undefined' && window.ASGOffline) {
          return await window.ASGOffline.find(collection);
        }
        return [];
      },
      syncPost: async (url, payload) => {
        if (typeof window !== 'undefined' && window.ASGOffline) {
          return await window.ASGOffline.syncPost(url, payload);
        }
      }
    }), [isOnline, queueCount]);

    return React.createElement(ASGOfflineContext.Provider, { value: contextValue }, children);
  }

  /**
   * useASGOffline Hook
   * Custom hook to access ASG Offline status and DB API in React components.
   */
  function useASGOffline() {
    const context = useContext(ASGOfflineContext);

    // Fallback if provider is not wrapped higher in tree
    const [localOnline, setLocalOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const [localQueueCount, setLocalQueueCount] = useState(0);

    useEffect(() => {
      let unSubStatus = null;
      let unSubQueue = null;

      if (typeof window !== 'undefined' && window.ASGOffline) {
        setLocalOnline(window.ASGOffline.isOnline);
        if (window.ASGOffline.onStatusChange) unSubStatus = window.ASGOffline.onStatusChange(setLocalOnline);
        if (window.ASGOffline.onQueueChange) unSubQueue = window.ASGOffline.onQueueChange(setLocalQueueCount);
        if (window.ASGOffline.getPOSAQueue) {
          window.ASGOffline.getPOSAQueue().then(q => setLocalQueueCount(q ? q.length : 0));
        }
      }

      return () => {
        if (typeof unSubStatus === 'function') unSubStatus();
        if (typeof unSubQueue === 'function') unSubQueue();
      };
    }, []);

    return {
      isOnline: context.isOnline !== undefined ? context.isOnline : localOnline,
      queueCount: context.queueCount !== undefined ? context.queueCount : localQueueCount,
      save: context.save || (async (col, data) => window.ASGOffline?.save(col, data)),
      find: context.find || (async (col) => window.ASGOffline?.find(col)),
      syncPost: context.syncPost || (async (url, payload) => window.ASGOffline?.syncPost(url, payload)),
      clearCache: async () => window.ASGOffline?.clearCache(),
      getCachedUrls: async () => window.ASGOffline?.getCachedUrls()
    };
  }

  return {
    ASGOfflineProvider,
    useASGOffline,
    ASGOfflineContext
  };
}));
