import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
// M1's isolated Rust install is optional. Ordinary system Cargo remains the default.
if (spawnSync('cargo', ['--version'], { windowsHide: true }).error) {
  const localCargo = path.join(root, '.cache', 'cargo');
  if (existsSync(path.join(localCargo, 'bin', 'cargo.exe'))) {
    env.CARGO_HOME = localCargo;
    env.RUSTUP_HOME = path.join(root, '.cache', 'rustup');
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    env[pathKey] = `${path.join(localCargo, 'bin')}${path.delimiter}${env[pathKey] ?? ''}`;
  }
}
const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), ...process.argv.slice(2)],
  { cwd: root, env, stdio: 'inherit', windowsHide: true },
);
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', () => {
  console.error('Unable to start the local Tauri CLI. Run npm install first.');
  process.exit(1);
});
