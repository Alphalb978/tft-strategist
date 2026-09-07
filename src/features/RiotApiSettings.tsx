import { useEffect, useRef, useState } from 'react';
import {
  RiotProviderError,
  riotStatusLabel,
  type RiotConnectionStatus,
  type RiotProvider,
} from '../providers/riot';
import type { Settings } from '../storage/repository';
export function RiotApiSettings({
  provider,
  settings,
}: {
  provider: RiotProvider;
  settings: Settings;
}) {
  const [status, setStatus] = useState<RiotConnectionStatus>({
    keyDetected: false,
    source: 'unavailable',
    status: 'missing-key',
  });
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  // Password stays in the transient DOM input, never application state or persistence.
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void provider
        .connectionStatus()
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch(() => {});
    refresh();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [provider]);
  async function run(action: 'save' | 'remove' | 'test') {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      let result: RiotConnectionStatus;
      if (action === 'save') {
        const value = input.current?.value.trim() ?? '';
        if (input.current) input.current.value = '';
        if (!value || !provider.saveCredential) {
          setNotice('Enter a Riot API key. Secure storage requires the desktop app.');
          return;
        }
        if (!/^RGAPI-[!-~]{6,506}$/.test(value)) {
          setNotice('Enter a Riot API key beginning with RGAPI-.');
          return;
        }
        result = await provider.saveCredential(value);
      } else if (action === 'remove' && provider.removeCredential)
        result = await provider.removeCredential();
      else if (action === 'test' && provider.testConnection)
        result = await provider.testConnection();
      else {
        setNotice('Credential management requires the desktop provider.');
        return;
      }
      setStatus(result);
      setNotice(
        action === 'save'
          ? 'Saved securely in Windows Credential Manager.'
          : action === 'remove'
            ? 'Stored credential removed.'
            : riotStatusLabel(result.status),
      );
      window.dispatchEvent(new Event('riot-credential-status'));
    } catch (error) {
      const code = error instanceof RiotProviderError ? error.code : 'unavailable';
      if (action === 'test') {
        setStatus((s) => ({ ...s, status: code }));
        setNotice(riotStatusLabel(code));
      } else
        setNotice(
          'Secure credential update unavailable. Use the Windows desktop app and try again.',
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel riot-api-settings" aria-label="Riot API settings">
      <div className="panel-heading">
        <h2>Riot API</h2>
        <span className="badge" aria-label="Riot API status">
          {riotStatusLabel(status.status)}
        </span>
      </div>
      <p>
        Account: {settings.riotId || 'Not configured'} · Region: {settings.riotPlatform}
      </p>
      <label className="setting-label">
        API key
        <input
          ref={input}
          type="password"
          aria-label="Riot API key"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste replacement key"
          disabled={busy}
        />
      </label>
      <div className="riot-key-actions">
        <button
          className="primary"
          disabled={busy || !provider.saveCredential}
          onClick={() => void run('save')}
        >
          Save key
        </button>
        <button
          className="secondary"
          disabled={busy || !status.keyDetected || !provider.testConnection}
          onClick={() => void run('test')}
        >
          Test connection
        </button>
        <button
          className="secondary"
          disabled={busy || !status.storedConfigured || !provider.removeCredential}
          onClick={() => void run('remove')}
        >
          Remove key
        </button>
      </div>
      {busy && <p role="status">Updating Riot API connection…</p>}
      {notice && <p role="status">{notice}</p>}
      <p className="fine-print">
        {status.source === 'native-environment'
          ? 'Environment override active. Saving or removing a stored key does not change that override.'
          : 'Stored securely for your Windows account. The saved key is never displayed.'}
      </p>
      <p className="fine-print">
        Last successful API request:{' '}
        {status.lastSuccess ? new Date(status.lastSuccess).toLocaleString() : 'None this session'}
      </p>
    </section>
  );
}
