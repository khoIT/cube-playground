/**
 * Ops Console is available only for the two games whose four ops data layers
 * (billing_detail / billing_lifetime / cs_ticket_detail / user_identity + mf_users)
 * are populated. These are the gds.config.json game ids — the VN tenants —
 * NOT the bare cube-workspace prefixes (`cfm`/`jus`). useGameContext().gameId
 * returns these ids; the cube proxy maps cfm_vn→cfm via the workspace prefix map.
 */
export const OPS_GAMES = ['cfm_vn', 'jus_vn'] as const;

export type OpsGameId = (typeof OPS_GAMES)[number];

export function isOpsGame(id: string): id is OpsGameId {
  return (OPS_GAMES as readonly string[]).includes(id);
}
