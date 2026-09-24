/**
 * db.js — tiny Promise wrapper around a single IndexedDB database used for
 * tag storage, last-session persistence, and the tagging-rules engine. No
 * external dependency.
 */
(function (g) {
  'use strict';
  var EV = g.EV || (g.EV = {});

  var DB_NAME = 'MantizEmlAnalyzerDB';
  var DB_VERSION = 3;
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!g.indexedDB) {
        reject(new Error('IndexedDB is not available in this browser'));
        return;
      }
      var req = g.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('session')) db.createObjectStore('session');
        if (!db.objectStoreNames.contains('rules')) db.createObjectStore('rules', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('ruleMatches')) {
          var store = db.createObjectStore('ruleMatches', { keyPath: 'key' });
          store.createIndex('by_rule', 'ruleId', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'service' });
      };
      // Fires when another open tab/window is holding an older-version
      // connection open, which would otherwise leave this open() request
      // pending forever with no error and no success — every tag/rule/
      // session read or write in the app would silently hang. Reject instead
      // so the caller can surface an actionable message.
      req.onblocked = function () {
        reject(new Error('Database upgrade blocked — close other open tabs/windows of this app and reload.'));
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    }).catch(function (err) {
      // Don't cache a failed open forever — a transient condition (e.g. the
      // blocking tab above) may clear, and the next call should retry rather
      // than replaying the same stale rejection for the rest of the session.
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return openDb().then(function (db) {
      return db.transaction(storeName, mode).objectStore(storeName);
    });
  }

  EV.db = {
    get: function (storeName, key) {
      return tx(storeName, 'readonly').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = store.get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    getAll: function (storeName) {
      return tx(storeName, 'readonly').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = store.getAll();
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    put: function (storeName, value, key) {
      return tx(storeName, 'readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = key !== undefined ? store.put(value, key) : store.put(value);
          req.onsuccess = function () { resolve(); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    delete: function (storeName, key) {
      return tx(storeName, 'readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = store.delete(key);
          req.onsuccess = function () { resolve(); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    getAllByIndex: function (storeName, indexName, value) {
      return tx(storeName, 'readonly').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = store.index(indexName).getAll(value);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    clear: function (storeName) {
      return tx(storeName, 'readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = store.clear();
          req.onsuccess = function () { resolve(); };
          req.onerror = function () { reject(req.error); };
        });
      });
    }
  };
})(typeof self !== 'undefined' ? self : this);
