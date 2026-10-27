// 存档位的本机持久化：放在设置文件 settings.json（键 saves.x01）。预览页没有本机设置时退回内存。
import { settingsStore } from '../kit/platform';
import type { Slots } from './save';

const KEY = 'saves.x01';
let memory: Slots = {};

export async function loadSlots(): Promise<Slots> {
  try {
    const v = await (await settingsStore()).get<Slots>(KEY);
    if (v && typeof v === 'object') memory = { ...v };
  } catch {
    // 没有本机设置文件（浏览器预览），用内存
  }
  return memory;
}

export async function storeSlots(slots: Slots): Promise<void> {
  memory = slots;
  try {
    await (await settingsStore()).set(KEY, slots);
  } catch {
    // 同上
  }
}
