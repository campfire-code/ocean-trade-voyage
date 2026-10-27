// 确定性随机：同样的输入永远得到同样的结果，存档读回来后世界不变。
export function hash32(...parts: (number | string)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e;
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 0 到 1 之间（含 0，不含 1）的确定性随机数 */
export const rand01 = (...parts: (number | string)[]): number => hash32(...parts) / 4294967296;

/** 从数组里确定性地挑一个 */
export function pick<T>(arr: readonly T[], ...parts: (number | string)[]): T {
  return arr[Math.floor(rand01(...parts) * arr.length)];
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round2 = (v: number) => Math.round(v * 100) / 100;
