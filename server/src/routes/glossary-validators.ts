/**
 * Zod schemas for glossary write endpoints.
 * Length caps mirror what the modal edit UI exposes; keep the two in sync.
 */

import { z } from 'zod';

const Label = z.string().trim().min(1).max(80);
const Description = z.string().trim().min(1).max(500);
const OptLabel = z.string().trim().min(1).max(80).nullable().optional();
const OptDescription = z.string().trim().min(1).max(500).nullable().optional();
const CatalogId = z.string().trim().min(1).max(128).nullable().optional();
const CatalogIds = z.array(z.string().trim().min(1).max(128)).max(20).optional();
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
}).strict();

export type CreateTermInput = z.infer<typeof CreateTermSchema>;
export type UpdateTermInput = z.infer<typeof UpdateTermSchema>;
export type StatusPatchInput = z.infer<typeof StatusPatchSchema>;
