// Credential is read with terminal echo disabled, passed only in the child
// environment, and never written to disk, argv, or diagnostic output.
import { spawn } from 'node:child_process';
if (!process.stdin.isTTY) throw Error('An interactive, non-echoing terminal is required.');
process.stdin.setRawMode(true);
process.stdin.resume();
console.log('Waiting for transient credential (input echo disabled).');
let input = '';
process.stdin.on('data', function receive(chunk) {
  input += chunk.toString();
  if (!/[\r\n]/.test(input)) return;
  process.stdin.off('data', receive);
  const credential = input.trim();
  input = '';
  const child = spawn('artifacts/release/current-meta/tft-strategist.exe', [], {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      RIOT_API_KEY: credential,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9223',
    },
  });
  console.log('Native validation app launched; credential stays in process memory.');
  // Closing the app ends this launcher. Do not echo further terminal input.
  child.once('exit', () => process.exit(0));
});
