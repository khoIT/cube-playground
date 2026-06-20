/**
 * Tool: get_company_context
 * Serves the curated VNGGames company + Game Publishing Platform (GPP) overview:
 * who VNGGames is, what each platform domain/product does (Nexus, Level Up, VGA,
 * Club, CS, Pay, Apollo, Promotion, GDS), and a glossary of the org/platform
 * terms leaders use. Game-independent (unlike get_topic_knowledge). Call this to
 * understand a leader's vocabulary and route a question correctly — never invent
 * what a platform product is.
 */

import { z } from 'zod';
import {
  getPlatformContext,
  findPlatformDomain,
  CONTEXT_SECTIONS,
  type ContextSection,
} from '../db/platform-context-seed.js';
import type { ToolContext } from '../types.js';

export const name = 'get_company_context';
export const description =
  'Get the curated VNGGames company + Game Publishing Platform (GPP) overview — what the company does and ' +
  'what each platform product means (Nexus, Level Up, VGA, Club, CS, Pay, Apollo, Promotion, GDS), plus a ' +
  'glossary (GS, GMT, GPI, Zalo OA, IAP/Webshop, ARPPU/NPU, PDPL, etc.). Call this when a question references ' +
  'the company, a platform product, or an org term you are not certain about, so you use the leader’s ' +
  'vocabulary and route correctly. Pass `product` (e.g. "apollo", "level up", "pay") to drill into one product; ' +
  '`section` (company | platform | glossary) to scope; omit both for the full overview. This is org/platform ' +
  'context, NOT queryable data — use the cube tools for actual metrics.';

export const inputSchema = {
  /** company | platform | glossary; omit for the full overview. */
  section: z.enum(CONTEXT_SECTIONS).optional(),
  /** Drill into one platform product by key/name/alias (e.g. "apollo", "level up"). */
  product: z.string().optional(),
};

export async function handler(
  args: { section?: ContextSection; product?: string },
  _ctx: ToolContext,
): Promise<unknown> {
  const ctx = getPlatformContext();
  if (!ctx) {
    return {
      found: false,
      note:
        'No curated company/platform context is available in this build. ' +
        'Answer from the data tools and ask the user to clarify any platform term you do not recognize.',
    };
  }

  // Drill into a single product first — most specific intent.
  if (args.product) {
    const domain = findPlatformDomain(args.product);
    if (!domain) {
      return {
        found: false,
        query: args.product,
        note: `No platform product matched "${args.product}".`,
        known_products: ctx.platform.domains.map((d) => d.name),
      };
    }
    return { found: true, product: domain };
  }

  if (args.section === 'company') return { found: true, company: ctx.company };
  if (args.section === 'platform') return { found: true, platform: ctx.platform };
  if (args.section === 'glossary') return { found: true, glossary: ctx.glossary };

  return {
    found: true,
    company: ctx.company,
    platform: ctx.platform,
    glossary: ctx.glossary,
  };
}
