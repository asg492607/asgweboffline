/**
 * ASG Offline Vue SDK (vue.js)
 * Official Vue 3 & Nuxt integration for ASG Offline Web Service.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['vue'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('vue'));
  } else {
    root.ASGOfflineVue = factory(root.Vue);
  }
}(typeof self !== 'undefined' ? self : this, function (Vue) {
  'use strict';

  /**
   * useASGOffline Composable for Vue 3 Composition API
   */
  function useASGOffline(options = {}) {
    const isOnline = Vue && Vue.ref ? Vue.ref(typeof navigator !== 'undefined' ? navigator.onLine : true) : { value: true };
    const queueCount = Vue && Vue.ref ? Vue.ref(0) : { value: 0 };

    if (typeof window !== 'undefined') {
      let unSubStatus = null;
      let unSubQueue = null;

      const checkSdk = () => {
        if (window.ASGOffline) {
          isOnline.value = window.ASGOffline.isOnline;
          if (window.ASGOffline.onStatusChange) {
            unSubStatus = window.ASGOffline.onStatusChange((status) => { isOnline.value = status; });
          }
          if (window.ASGOffline.onQueueChange) {
            unSubQueue = window.ASGOffline.onQueueChange((count) => { queueCount.value = count; });
          }
          if (window.ASGOffline.getPOSAQueue) {
            window.ASGOffline.getPOSAQueue().then(q => { queueCount.value = q ? q.length : 0; });
          }
        }
      };

      const cleanup = () => {
        if (typeof unSubStatus === 'function') unSubStatus();
        if (typeof unSubQueue === 'function') unSubQueue();
      };

      if (Vue && Vue.onMounted) {
        Vue.onMounted(checkSdk);
      } else {
        checkSdk();
      }

      if (Vue && Vue.onUnmounted) {
        Vue.onUnmounted(cleanup);
      }
    }

    const save = async (collection, data) => {
      if (typeof window !== 'undefined' && window.ASGOffline) {
        return await window.ASGOffline.save(collection, data);
      }
    };

    const find = async (collection) => {
      if (typeof window !== 'undefined' && window.ASGOffline) {
        return await window.ASGOffline.find(collection);
      }
      return [];
    };

    const syncPost = async (url, payload) => {
      if (typeof window !== 'undefined' && window.ASGOffline) {
        return await window.ASGOffline.syncPost(url, payload);
      }
    };

    const clearCache = async () => {
      if (typeof window !== 'undefined' && window.ASGOffline) {
        return await window.ASGOffline.clearCache();
      }
    };

    return {
      isOnline,
      queueCount,
      save,
      find,
      syncPost,
      clearCache
    };
  }

  return {
    useASGOffline
  };
}));
