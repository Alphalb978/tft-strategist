export const ACCENTS = { Gold: '#e7c286', Blue: '#91bcff', Teal: '#83daca', Purple: '#c4adff' };
export const BACKGROUNDS = {
  Navy: ['#10151e', '#0c1119', '#171f2b', '#202b39', '#303d4e'],
  Charcoal: ['#191b1f', '#131518', '#22252b', '#2d323a', '#414751'],
  'Near-black': ['#0c0e12', '#090b0e', '#15181e', '#20252d', '#333b47'],
};
export interface Appearance {
  accent: keyof typeof ACCENTS;
  background: keyof typeof BACKGROUNDS;
}
export const DEFAULT_APPEARANCE: Appearance = { accent: 'Gold', background: 'Navy' };
export const APPEARANCE_KEY = 'strategist:appearance:v1';
export function normalizeAppearance(value: unknown): Appearance {
  const saved = value && typeof value === 'object' ? (value as Partial<Appearance>) : {};
  return {
    accent: Object.hasOwn(ACCENTS, saved.accent ?? '') ? saved.accent! : 'Gold',
    background: Object.hasOwn(BACKGROUNDS, saved.background ?? '') ? saved.background! : 'Navy',
  };
}
export function loadAppearance(): Appearance {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}
export function applyAppearance(value: Appearance) {
  const root = document.documentElement;
  root.style.setProperty('--accent', ACCENTS[value.accent]);
  ['--background', '--sidebar', '--panel', '--raised', '--line'].forEach((token, index) =>
    root.style.setProperty(token, BACKGROUNDS[value.background][index]),
  );
  root.dataset.accent = value.accent;
  root.dataset.background = value.background;
}
