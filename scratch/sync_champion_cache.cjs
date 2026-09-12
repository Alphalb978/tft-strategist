const fs = require('fs');
const path = require('path');

const raw = JSON.parse(fs.readFileSync('data/fixtures/cdragon-set18.json', 'utf8'));
const set = raw.setData[0];
const champions = set.champions;

console.log(`Total champions in Set 18 fixture: ${champions.length}`);
const cacheDir = 'artifacts/champion_cache';
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

async function run() {
  let downloaded = 0;
  let alreadyPresent = 0;
  let failed = 0;

  for (const c of champions) {
    const apiName = c.apiName;
    const dest = path.join(cacheDir, `${apiName}.png`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      alreadyPresent++;
      continue;
    }

    // CommunityDragon URL
    let iconPath = c.squareIcon || c.icon || '';
    if (!iconPath) {
      console.log(`No icon for ${apiName}`);
      continue;
    }

    // Normalize cdragon path: e.g. /lol-game-data/assets/v1/champion-icons/123.png -> raw.communitydragon.org
    let url = iconPath;
    if (iconPath.startsWith('http')) {
      url = iconPath;
    } else {
      const cleanPath = iconPath
        .replace('/lol-game-data/assets/', '')
        .replace('assets/', '')
        .toLowerCase();
      url = `https://raw.communitydragon.org/latest/game/${cleanPath}`;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Try fallback URL with lowercase path
        const fallbackUrl = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/${iconPath.replace('/lol-game-data/assets/', '').toLowerCase()}`;
        const res2 = await fetch(fallbackUrl);
        if (!res2.ok) {
          throw new Error(`HTTP ${res.status} & ${res2.status}`);
        }
        const buf = Buffer.from(await res2.arrayBuffer());
        fs.writeFileSync(dest, buf);
        downloaded++;
        console.log(`Downloaded (fallback) ${apiName} (${buf.length} bytes)`);
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(dest, buf);
        downloaded++;
        console.log(`Downloaded ${apiName} (${buf.length} bytes)`);
      }
    } catch (err) {
      console.log(`Failed to download ${apiName}: ${err.message} (url: ${url})`);
      failed++;
    }
  }

  console.log(`Done! Present: ${alreadyPresent}, Downloaded: ${downloaded}, Failed: ${failed}`);
}

run();
