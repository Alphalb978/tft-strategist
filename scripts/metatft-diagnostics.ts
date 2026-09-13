import { z } from 'zod';
import { ExternalValidationError } from '../src/providers/externalMeta';

export type MetaTftFailureKind =
  | 'network-navigation'
  | 'endpoint-schema'
  | 'browser-challenge'
  | 'normalization-mapping'
  | 'set-mismatch'
  | 'patch-mismatch'
  | 'snapshot-validation';

export class MetaTftRefreshError extends Error {
  constructor(
    public readonly kind: MetaTftFailureKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MetaTftRefreshError';
  }
}

const publicPatchSchema = z.object({
  patch: z.string().regex(/^\d+\.\d+$/),
  b_patch_version: z.string().optional(),
});

export function validateMetaTftPatchPreflight(input: unknown, expectedPatch: string) {
  const parsed = publicPatchSchema.safeParse(input);
  if (!parsed.success)
    throw new MetaTftRefreshError(
      'endpoint-schema',
      'MetaTFT patch endpoint or schema changed · using last good snapshot',
    );
  if (parsed.data.patch !== expectedPatch)
    throw new MetaTftRefreshError(
      'patch-mismatch',
      `MetaTFT currently reports TFT ${parsed.data.patch}; Strategist is validated for ${expectedPatch}. Update the app's reviewed TFT data before refreshing external meta. Last good snapshot retained.`,
    );
  return parsed.data;
}

export function safeMetaTftFailure(error: unknown): MetaTftRefreshError {
  if (error instanceof MetaTftRefreshError) return error;
  if (error instanceof ExternalValidationError) {
    if (error.code === 'set-mismatch')
      return new MetaTftRefreshError('set-mismatch', error.message, { cause: error });
    if (error.code === 'patch-mismatch')
      return new MetaTftRefreshError('patch-mismatch', error.message, { cause: error });
    if (error.code === 'entity-mapping')
      return new MetaTftRefreshError(
        'normalization-mapping',
        `MetaTFT normalization or mapping failed · using last good snapshot. ${error.message}`,
        { cause: error },
      );
  }
  return new MetaTftRefreshError(
    'snapshot-validation',
    'MetaTFT snapshot validation failed · using last good snapshot',
    { cause: error },
  );
}
