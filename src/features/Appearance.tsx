import { useState } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import {
  ACCENTS,
  BACKGROUNDS,
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  loadAppearance,
  applyAppearance,
  type Appearance as AppearanceValue,
} from '../app/appearance';

export function Appearance() {
  const [value, setValue] = useState(loadAppearance);
  const [message, setMessage] = useState('');
  const change = (next: AppearanceValue) => {
    setValue(next);
    applyAppearance(next);
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
      setMessage('');
    } catch {
      setMessage('Applied for this visit. Appearance could not be saved.');
    }
  };
  return (
    <section className="appearance-section panel" id="appearance">
      <div className="panel-heading">
        <h2>Appearance</h2>
        <button className="text-button" onClick={() => change({ ...DEFAULT_APPEARANCE })}>
          <RotateCcw size={14} />
          Reset appearance
        </button>
      </div>
      <div className="appearance-options">
        <fieldset>
          <legend>Accent</legend>
          <div className="swatch-list">
            {Object.entries(ACCENTS).map(([name, color]) => (
              <button
                key={name}
                aria-label={`${name} accent`}
                aria-pressed={value.accent === name}
                onClick={() => change({ ...value, accent: name as AppearanceValue['accent'] })}
              >
                <span className="color-swatch" style={{ background: color }}>
                  {value.accent === name && <Check size={16} />}
                </span>
                {name}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Background</legend>
          <div className="background-list">
            {Object.entries(BACKGROUNDS).map(([name, colors]) => (
              <button
                key={name}
                aria-label={`${name} background`}
                aria-pressed={value.background === name}
                onClick={() =>
                  change({ ...value, background: name as AppearanceValue['background'] })
                }
              >
                <span style={{ background: colors[0], borderColor: colors[4] }} />
                {name}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
