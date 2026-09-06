# M10 Addendum — Lightweight Theme Customization

This addendum is part of M10 and should be read after `tasks/M10_V1_PRODUCT_POLISH_HARDENING.md`.

## Goal
Add simple, polished visual personalization without turning the app into a theme editor or weakening the professional visual system.

The user should be able to make the app feel a little more personal while every route still looks intentionally designed.

## Required appearance settings
Add a compact **Appearance** section to normal product settings.

Support at minimum:

### Accent
- Default warm/gold theme remains the shipped default.
- Provide a small set of professionally tuned accent presets, for example Gold, Blue, Teal, Purple and Rose/Red if they work with the final design.
- Also provide an optional custom accent color picker/hex value if it can be implemented safely and simply.
- Accent should drive appropriate interactive/highlight tokens through the design system rather than scattered hardcoded CSS.

### Background
Provide a small set of deliberately tuned dark background foundations rather than unrestricted arbitrary backgrounds. Good examples are:
- Navy (default);
- Charcoal;
- Near-black.

If Astra finds another dark preset clearly improves the product, it may include it, but keep the list small.

Do not support bright/light themes in M10 unless they can be completed to the same professional standard without materially expanding scope.

### Reset
Provide one obvious `Reset appearance` / `Use default theme` action.

## Behavior
- Changes should preview/apply immediately.
- Persist the user's appearance choice locally across restart.
- Appearance state must not alter TFT data, recommendation evidence, scores, sessions or M8/M9 history.
- Theme persistence should fail safely; an invalid/missing saved value falls back to the default professional theme.
- No network dependency.

## Design-system integration
Implement theme personalization through central CSS/design tokens.

Prefer semantic variables such as:
- app/background;
- sidebar/background;
- surface elevations;
- border/divider;
- primary accent;
- accent hover/active;
- focus ring;
- selected state.

Do not create per-page theme overrides or duplicate styles for each preset.

## Important color semantics
User accent customization must **not** recolor semantic status meaning indiscriminately.

Keep success/warning/error/stale/disabled/contest-risk meanings independently legible and non-color-only.

A purple accent must not make an error purple; a red accent must not make every selected state look like an error. Astra should tune tokens so the design remains understandable.

## Accessibility
For every included preset and accepted custom accent:
- preserve readable text contrast;
- preserve visible keyboard focus;
- keep buttons/links/selected states distinguishable;
- reject, clamp, derive or fall back from custom colors that create obviously unusable contrast rather than letting the user break the UI.

The custom accent can be transformed into derived hover/subtle/background variants rather than using the exact raw color everywhere.

## UX standard
This should feel like a small premium personalization feature, not developer configuration.

Preferred UI shape:
- visual color swatches;
- compact background preset selector;
- optional color picker for Custom;
- live preview;
- reset action.

Avoid RGB sliders, dozens of tokens, JSON theme editing, typography controls or other advanced customization in V1.

## Visual acceptance
During M10 screenshot acceptance, inspect at least:
- default Gold + Navy;
- one alternate accent preset;
- one alternate background preset;
- custom accent if implemented;

Check at 1440 and 860 px that the theme remains cohesive across:
- Your Plans;
- Playbook/Active Plan;
- Post-game;
- Settings.

Document the final theme settings and persistence behavior in `docs/M10_V1_RELEASE_REPORT.md`.
