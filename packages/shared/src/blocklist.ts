import { z } from 'zod'
import { CAPTURE_BLOCK_REASONS } from './classify'

/** Schemas for the capture decision. The rules themselves live in `classify.ts`, which has no zod. */
export {
  CAPTURE_BLOCK_REASONS,
  type CaptureContext,
  captureEligibility,
  sourceTypeForUrl,
} from './classify'

export const CaptureBlockReason = z.enum(CAPTURE_BLOCK_REASONS)
export type CaptureBlockReason = z.infer<typeof CaptureBlockReason>

export const CaptureEligibility = z.object({
  allowed: z.boolean(),
  reason: CaptureBlockReason.nullable(),
  /** The rule that matched, for display: a host suffix or a path pattern name. */
  rule: z.string().nullable(),
})
export type CaptureEligibility = z.infer<typeof CaptureEligibility>
