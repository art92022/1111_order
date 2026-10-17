// 產生「可取冷凍交貨便」的 7-11 門市資料，給訂購頁的門市選單使用
// 資料來源：uniopen 門市查詢頁使用的公開門市檔（services 含 "66" = 冷凍交貨便）
// 執行：node scripts/build-711-frozen.mjs   → 輸出 data/711-frozen.json
// 注意：這不是 7-11 官方提供的 API，來源網址或格式可能改變；失敗時會保留舊檔並回報錯誤

import { writeFile, readFile, mkdir } from 'node:fs/promises';

const SOURCE = 'https://cdn.uniopen.com/static_resources/stores_v2/stores.json';
const FROZEN_SERVICE = '66';
const OUT = new URL('../data/711-frozen.json', import.meta.url);

// 地址拆解：縣市 → 鄉鎮市區 → 路段（沒有路名的鄉村地址改用「村里」分組）
function parseAddress(address) {
  const s = address.replace(/臺/g, '台').replace(/\s/g, '');
  const cityM = s.match(/^(.{2}[市縣])/);
  if (!cityM) return null;
  const city = cityM[1];
  const after = s.slice(city.length);
  // 直轄市與省轄市底下是「區」；縣底下是「鄉、鎮、市」
  const distM = city.endsWith('市') ? after.match(/^(.{1,3}?區)/) : after.match(/^(.{1,3}?[鄉鎮市])/);
  if (!distM) return null;
  const dist = distM[1];
  let rest = after.slice(dist.length);
  const village = (rest.match(/^([^路街道\d]{1,4}?[里村])/) || [])[1] || '';
  rest = rest.replace(/^[^路街道\d]{1,4}?[里村](?=\S)/, '').replace(/^\d+鄰/, '');
  const roadM = rest.match(/^(.+?(?:路|街|大道)(?:[一二三四五六七八九十]+段)?)/);
  return { city, dist, road: roadM ? roadM[1] : (village || '其他') };
}

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`下載門市資料失敗：HTTP ${res.status}`);
const all = await res.json();
if (!Array.isArray(all)) throw new Error('門市資料格式改變：不是陣列');

const frozen = all.filter(s => s && s.type === '7-11' && Array.isArray(s.services) && s.services.includes(FROZEN_SERVICE));
// 防呆：數量異常時不覆寫（2026/10 約 6,900 間）
if (frozen.length < 3000) throw new Error(`冷凍門市只有 ${frozen.length} 間，數量異常，停止更新`);

// tree[縣市][區][路] = [[店號, 店名, 地址], ...]
const tree = {};
let skipped = 0;
for (const s of frozen) {
  const p = parseAddress(s.address || '');
  if (!p) { skipped++; continue; }
  tree[p.city] ??= {};
  tree[p.city][p.dist] ??= {};
  tree[p.city][p.dist][p.road] ??= [];
  tree[p.city][p.dist][p.road].push([String(s.id), String(s.name).replace(/門市$/, ''), s.address]);
}

const out = {
  updated: new Date().toISOString(),
  source: SOURCE,
  count: frozen.length - skipped,
  tree,
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
// 門市沒有變動就不改檔（避免每天只因為時間戳記而產生新版本）
try {
  const old = JSON.parse(await readFile(OUT, 'utf8'));
  if (JSON.stringify(old.tree) === JSON.stringify(tree)) {
    console.log(`門市名單沒有變動（${out.count} 間）`);
    process.exit(0);
  }
} catch { /* 第一次執行，還沒有舊檔 */ }
await writeFile(OUT, JSON.stringify(out));
console.log(`完成：${out.count} 間冷凍門市（略過 ${skipped} 筆無法解析的地址）`);
