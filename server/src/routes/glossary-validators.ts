/**
 * Zod schemas for glossary write endpoints.
 * Length caps mirror what the modal edit UI exposes; keep the two in sync.
 */

import { z } from 'zod';
import { isValidRef } from '../services/trust-mapping.js';

const Label = z.string().trim().min(1).max(80);
const Description = z.string().trim().min(1).max(500);
const OptLabel = z.string().trim().min(1).max(80).nullable().optional();
const OptDescription = z.string().trim().min(1).max(500).nullable().optional();
const CatalogId = z.string().trim().min(1).max(128).nullable().optional();
// Typed multi-refs: every secondary ref must be `<namespace>/<id>` with the
// namespace in the allowlist (business_metrics | data_model | segments) and no
// path traversal. Rejects unknown namespaces / malformed refs on write.
const CatalogIds = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(128)
      .refine(isValidRef, {
        message: 'ref must be <namespace>/<id> where namespace ∈ business_metrics|data_model|segments',
      }),
  )
  .max(20)
  .optional();
const AliasList = z.array(z.string().trim().min(1).max(40)).max(20).optional();
const Category = z.string().trim().min(1).max(64).nullable().optional();
const Editor = z.string().trim().min(1).max(80).nullable().optional();

// Phase 02a concept-tier optional fields.
const EntityCube = z.string().trim().min(1).max(64).nullable().optional();
const EntityPk = z.string().trim().min(1).max(128).nullable().optional();
const MeasureRef = z.string().trim().min(1).max(128).nullable().optional();
// `default_filter` lives inline in the term so the resolver can apply it
// without a second hop. Constrain ops to a safe allowlist; arbitrary user
// filters are out of scope (see phase plan, Security Considerations).
const FilterOp = z.enum(['>', '>=', '<', '<=', '=', '!=', 'IN', 'NOT IN']);
const DefaultFilter = z
  .object({
    member: z.string().trim().min(1).max(128),
    op: FilterOp,
    value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
  })
  .strict()
  .nullable()
  .optional();
const Ranking = z
  .object({
    order: z.enum(['ASC', 'DESC']),
    default_limit: z.number().int().min(1).max(1000),
  })
  .strict()
  .nullable()
  .optional();

// Exported so the promote path validates a derived filter through the SAME
// shape a direct POST/PUT enforces (no asymmetric trust boundary).
export const DefaultFilterSchema = z
  .object({
    member: z.string().trim().min(1).max(128),
    op: FilterOp,
    value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
  })
  .strict();
const TrustTier = z.enum(['certified', 'experimental']).nullable().optional();

export const CreateTermSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  label: Label,
  description: Description,
  primaryCatalogId: CatalogId,
  secondaryCatalogIds: CatalogIds,
  aliases: AliasList,
  category: Category,
  labelVi: OptLabel,
  descriptionVi: OptDescription,
  aliasesVi: AliasList,
  editorName: Editor,
  entityCube: EntityCube,
  entityPk: EntityPk,
  defaultMeasureRef: MeasureRef,
  defaultFilter: DefaultFilter,
  ranking: Ranking,
  trustTier: TrustTier,
}).strict();

export const UpdateTermSchema = z.object({
  label: Label,
  description: Description,
  primaryCatalogId: CatalogId,
  secondaryCatalogIds: CatalogIds,
  aliases: AliasList,
  category: Category,
  labelVi: OptLabel,
  descriptionVi: OptDescription,
  aliasesVi: AliasList,
  editorName: Editor,
  entityCube: EntityCube,
  entityPk: EntityPk,
  defaultMeasureRef: MeasureRef,
  defaultFilter: DefaultFilter,
  ranking: Ranking,
  trustTier: TrustTier,
}).strict();

export const StatusPatchSchema = z.object({
  status: z.enum(['draft', 'official']),
  editorName: Editor,
}).strict();

export const ListQuerySchema = z.object({
  status: z.enum(['draft', 'official']).optional(),
  // Unified-trust alias for the legacy `status` filter (kept one release so
  // callers can migrate). `trust=certified` ≈ `status=official`,
  // `trust=draft` ≈ `status=draft`. `status` wins if both are sent.
  trust: z.enum(['certified', 'draft']).optional(),
}).strict();

export type CreateTermInput = z.infer<typeof CreateTermSchema>;
export type UpdateTermInput = z.infer<typeof UpdateTermSchema>;
export type StatusPatchInput = z.infer<typeof StatusPatchSchema>;
