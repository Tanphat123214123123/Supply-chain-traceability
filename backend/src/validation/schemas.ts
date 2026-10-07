import { z } from 'zod';

const STAGES = ['HARVEST', 'PROCESSING', 'QUALITY_CHECK', 'PACKAGING', 'DISTRIBUTION', 'RETAIL'] as const;
const ROLES = ['FARMER', 'PROCESSOR', 'INSPECTOR', 'DISTRIBUTOR', 'RETAILER', 'ADMIN'] as const;

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const registerBase = {
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  password: z.string().min(8).max(200),
  organization: z.string().trim().min(1).max(200),
};

/**
 * Two ways in, and neither lets the registrant pick a role:
 *   • `workspace` founds a new tenant — the registrant becomes its ADMIN;
 *   • `invite` redeems a code an ADMIN issued — the role is the invitation's.
 * Joining an existing tenant by knowing its slug is no longer possible.
 */
export const registerSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('workspace'),
    ...registerBase,
    // Workspace identifier (like a Slack workspace slug). Lowercase + hyphens
    // only, matching how it's displayed/typed (e.g. "acme-coffee").
    tenantSlug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9-]+$/, 'Chỉ dùng chữ thường, số và dấu gạch ngang'),
    tenantName: z.string().trim().min(1).max(200),
  }),
  z.object({
    mode: z.literal('invite'),
    ...registerBase,
    inviteCode: z.string().trim().min(8).max(40),
  }),
]);

export const createInvitationSchema = z.object({
  role: z.enum(ROLES),
  email: z.string().trim().email().optional(),
  note: z.string().trim().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const createBatchSchema = z.object({
  productName: z.string().trim().min(1).max(200),
  productType: z.string().trim().min(1).max(200),
  origin: z.string().trim().min(1).max(200),
  quantity: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(50),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const recallBatchSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

// Stage-specific facts (moisture, grade, destination...). Flat key → scalar
// only: the values end up in the hash preimage and on printed reports, so
// nested objects or huge blobs have no business here.
const eventDataValue = z.union([z.string().trim().max(500), z.number().finite(), z.boolean()]);
const eventDataSchema = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/), eventDataValue)
  .refine((d) => Object.keys(d).length <= 30, 'Too many data fields');

export const recordEventSchema = z.object({
  batchId: z.string().trim().min(1),
  stage: z.enum(STAGES),
  location: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
  data: eventDataSchema.optional(),
  // Who takes custody next — required (enforced in SupplyChainService, not
  // here, since it's conditional on role/stage) for non-ADMIN actors advancing
  // to a non-terminal stage.
  assignNextTo: z.string().trim().min(1).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Capped at 500 rather than 100: the Kanban board and the "existing batch"
  // picker in RecordEvent both need a single unpaginated-feeling fetch of
  // every open batch, which comfortably fits below that ceiling at demo scale.
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  search: z.string().trim().max(200).optional(),
  // A stage, or NONE for batches with no event yet — powers the Kanban columns.
  stage: z.enum([...STAGES, 'NONE']).optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  organization: z.string().trim().min(1).max(200).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export const anomalyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // z.coerce.boolean() would turn the string "false" into `true` (any non-empty
  // string is truthy) — parse the literal query values explicitly instead.
  resolved: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});

export const setActorStatusSchema = z.object({
  isActive: z.boolean(),
});

export const setActorRoleSchema = z.object({
  role: z.enum(ROLES),
});

export const exportBatchesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  origin: z.string().trim().max(200).optional(),
  format: z.enum(['csv', 'json']).default('csv'),
});
