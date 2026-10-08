class FuelDataLoader {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://mkboxself.github.io/fuel-data/';
    this.defaultFile = options.defaultFile || 'stations.json';
    this.cacheName = options.cacheName || 'mkfuel-data-cache';
    this.storeName = options.storeName || 'fuel-data-store';
    this.ttlMs = options.ttlMs || 60 * 60 * 1000;
    this.data = null;
    this.loading = false;
  }

  async load(fileName = this.defaultFile, { forceRefresh = false } = {}) {
    if (this.loading) {
      return this.data;
    }

    if (!forceRefresh && this.data) {
      return this.data;
    }

    if (!forceRefresh) {
      const cached = await this.readCache(fileName);
      if (cached) {
        this.data = cached;
        return cached;
      }
    }

    this.loading = true;

    try {
      const url = `${this.baseUrl}${fileName}`;
      const response = await fetch(url, {
        cache: 'no-cache',
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      this.data = json;
      await this.writeCache(fileName, json);
      return json;
    } finally {
      this.loading = false;
    }
  }

  async readCache(fileName) {
    try {
      const db = await this.openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const request = store.get(fileName);

        request.onsuccess = () => {
          const entry = request.result;
          if (!entry) {
            resolve(null);
            return;
          }

          const isFresh = Date.now() - entry.timestamp < this.ttlMs;
          if (!isFresh) {
            this.deleteCache(fileName).catch(() => {});
            resolve(null);
            return;
          }

          resolve(entry.data);
        };

        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('Cache read failed:', error);
      return null;
    }
  }

  async writeCache(fileName, data) {
    try {
      const db = await this.openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const request = store.put({
          id: fileName,
          data,
          timestamp: Date.now()
        });

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('Cache write failed:', error);
    }
  }

  async deleteCache(fileName) {
    try {
      const db = await this.openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const request = store.delete(fileName);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('Cache delete failed:', error);
    }
  }

  openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB non supportato dal browser'));
        return;
      }

      const request = indexedDB.open(this.cacheName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

window.FuelDataLoader = FuelDataLoader;

if (!window.__fuelDataLoader) {
  window.__fuelDataLoader = new FuelDataLoader();
}

window.loadFuelData = function(fileName, options) {
  return window.__fuelDataLoader.load(fileName, options || {});
};
