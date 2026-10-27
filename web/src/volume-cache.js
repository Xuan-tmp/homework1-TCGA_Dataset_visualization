export class VolumeCache {
  constructor({ maxEntries = 3, maxBytes = 192 * 1024 * 1024 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.totalBytes = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value, sizeBytes = value?.data?.byteLength || 0) {
    if (this.entries.has(key)) {
      this.totalBytes -= this.entries.get(key).sizeBytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { value, sizeBytes });
    this.totalBytes += sizeBytes;
    this.trim(key);
  }

  trim(protectedKey = null) {
    while (
      this.entries.size > this.maxEntries ||
      (this.totalBytes > this.maxBytes && this.entries.size > 1)
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === protectedKey && this.entries.size === 1) break;
      const entry = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.totalBytes -= entry.sizeBytes;
    }
  }

  get size() {
    return this.entries.size;
  }

  get sizeBytes() {
    return this.totalBytes;
  }
}
