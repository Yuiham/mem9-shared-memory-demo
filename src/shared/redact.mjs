// Masks secrets and the server address in everything the programs print.

export function maskKey(value) {
  const prefix = /^([a-z]+_)/.exec(value);
  return `${prefix ? prefix[1] : ''}****${value.slice(-4)}`;
}

// Keys by their shape, so one that was never registered (an echo from a server) is masked too.
const GENERIC = /\b(?:chain_|whsec_|mem9_admin_)[A-Za-z0-9_-]{8,}/g;

export class Redactor {
  constructor() {
    this.entries = [];
  }

  addSecret(value) {
    if (typeof value !== 'string' || value.length < 6) return;
    this.#add(value, maskKey(value));
  }

  addAddress(address, mask = '<server-address>') {
    if (typeof address !== 'string' || !address) return;
    this.#add(address, mask);
    this.#add(address.replace(/\/+$/, ''), mask);
    try {
      this.#add(new URL(address).host, mask);
    } catch {
      // Not a URL; the plain string is already registered.
    }
  }

  apply(text) {
    let out = String(text);
    for (const { value, mask } of this.entries) out = out.split(value).join(mask);
    return out.replace(GENERIC, (match) => maskKey(match));
  }

  #add(value, mask) {
    if (!value || this.entries.some((entry) => entry.value === value)) return;
    this.entries.push({ value, mask });
    this.entries.sort((a, b) => b.value.length - a.value.length);
  }
}
