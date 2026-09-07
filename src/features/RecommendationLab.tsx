import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HomeRecommendationModelConfig } from '../domain/models';
import type { Settings } from '../storage/repository';
import {
  DEFAULT_HOME_RECOMMENDATION_CONFIG,
  HOME_RECOMMENDATION_MODEL_VERSION,
  homeRecommendationConfigErrors,
  normalizeHomeRecommendationConfig,
} from '../strategy/homeScoring';

type ConfigKey = keyof HomeRecommendationModelConfig;

const controls: {
  group: string;
  key: ConfigKey;
  label: string;
  min: number;
  max: number;
  step: number;
  scale?: number;
  suffix?: string;
}[] = [
  {
    group: 'Base Performance',
    key: 'top4Weight',
    label: 'Top-4 weight',
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    suffix: '%',
  },
  {
    group: 'Base Performance',
    key: 'averagePlacementWeight',
    label: 'Average-placement weight',
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    suffix: '%',
  },
  {
    group: 'Base Performance',
    key: 'winRateWeight',
    label: 'Win-rate weight',
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    suffix: '%',
  },
  {
    group: 'Low-Pick Edge',
    key: 'lowPickQualityGate',
    label: 'Base-performance percentile gate',
    min: 0,
    max: 100,
    step: 1,
    suffix: 'th percentile',
  },
  {
    group: 'Low-Pick Edge',
    key: 'lowPickQualityRamp',
    label: 'Base-percentile ramp',
    min: 1,
    max: 50,
    step: 1,
    suffix: ' percentile points',
  },
  {
    group: 'Low-Pick Edge',
    key: 'lowPickMinimumReliability',
    label: 'Minimum evidence reliability',
    min: 0,
    max: 95,
    step: 1,
    scale: 100,
    suffix: '%',
  },
  {
    group: 'Low-Pick Edge',
    key: 'lowPickCurve',
    label: 'Popularity percentile curve',
    min: 0.25,
    max: 4,
    step: 0.05,
  },
  {
    group: 'Low-Pick Edge',
    key: 'maxLowPickBonus',
    label: 'Maximum low-pick bonus',
    min: 0,
    max: 15,
    step: 0.5,
    suffix: ' pts',
  },
  {
    group: 'Low-Pick Edge',
    key: 'maxPopularityPenalty',
    label: 'Maximum popularity penalty',
    min: 0,
    max: 10,
    step: 0.5,
    suffix: ' pts',
  },
  {
    group: 'Lobby',
    key: 'maxCleanLobbyBonus',
    label: 'Maximum clean-lobby bonus',
    min: 0,
    max: 10,
    step: 0.5,
    suffix: ' pts',
  },
  {
    group: 'Lobby',
    key: 'maxMediumContestPenalty',
    label: 'Maximum medium-contest penalty',
    min: 0,
    max: 25,
    step: 0.5,
    suffix: ' pts',
  },
  {
    group: 'Lobby',
    key: 'maxHighContestPenalty',
    label: 'Maximum high-contest penalty',
    min: 0,
    max: 40,
    step: 0.5,
    suffix: ' pts',
  },
  {
    group: 'Lobby',
    key: 'lobbyCoverageExponent',
    label: 'Evidence coverage scaling',
    min: 0.25,
    max: 3,
    step: 0.05,
  },
];

export function RecommendationLab({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (settings: Settings) => void;
}) {
  const [draft, setDraft] = useState(settings.homeRecommendation);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => setDraft(settings.homeRecommendation), [settings.homeRecommendation]);

  const update = (key: ConfigKey, displayedValue: number, scale = 1) => {
    const next = { ...draft, [key]: displayedValue / scale };
    const validation = homeRecommendationConfigErrors(next);
    setErrors(validation);
    if (validation.length) return;
    const normalized = normalizeHomeRecommendationConfig(next);
    setDraft(normalized);
    onSave({ ...settings, homeRecommendation: normalized });
  };

  return (
    <details className="recommendation-lab">
      <summary>
        <SlidersHorizontal size={16} />
        <span>
          <strong>Recommendation Lab</strong>
          <small>{HOME_RECOMMENDATION_MODEL_VERSION} · advanced</small>
        </span>
      </summary>
      <section className="panel" aria-label="Recommendation model settings">
        <div className="model-lab-intro">
          <div>
            <h2>Contest Edge model</h2>
            <p>
              Changes save locally and immediately recompute Your Plans. Final Safety is a ranking
              index, not a probability.
            </p>
          </div>
          <button
            className="secondary"
            onClick={() => {
              setDraft(DEFAULT_HOME_RECOMMENDATION_CONFIG);
              setErrors([]);
              onSave({ ...settings, homeRecommendation: DEFAULT_HOME_RECOMMENDATION_CONFIG });
            }}
          >
            <RotateCcw size={14} /> Reset Defaults
          </button>
        </div>
        {[...new Set(controls.map((control) => control.group))].map((group) => (
          <fieldset key={group}>
            <legend>{group}</legend>
            <div className="model-control-grid">
              {controls
                .filter((control) => control.group === group)
                .map((control) => {
                  const scale = control.scale ?? 1;
                  return (
                    <label key={control.key}>
                      <span>{control.label}</span>
                      <span className="model-number">
                        <input
                          type="number"
                          aria-label={control.label}
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          value={Math.round(draft[control.key] * scale * 100) / 100}
                          onChange={(event) =>
                            update(control.key, event.currentTarget.valueAsNumber, scale)
                          }
                        />
                        <small>{control.suffix}</small>
                      </span>
                    </label>
                  );
                })}
            </div>
          </fieldset>
        ))}
        {errors.length > 0 && (
          <div className="model-errors" role="alert">
            {errors.join(' ')} Previous valid settings remain active.
          </div>
        )}
        <p className="fine-print">
          Base weights normalize to 100%. Unsupported, non-finite, and extreme saved values fail
          safely to bounded defaults.
        </p>
      </section>
    </details>
  );
}
