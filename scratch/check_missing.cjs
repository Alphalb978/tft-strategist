const fs = require('fs');
const files = new Set(fs.readdirSync('artifacts/champion_cache').map(f => f.replace('.png', '')));
const content = fs.readFileSync('src-tauri/src/shop_vision.rs', 'utf8');
const regex = /api_name:\s*"([^"]+)"/g;
const matches = [];
let match;
while ((match = regex.exec(content)) !== null) {
  matches.push(match[1]);
}
const missing = matches.filter(m => !files.has(m));
console.log('Total candidates:', matches.length);
console.log('Missing count:', missing.length);
console.log('Missing list:', missing);
