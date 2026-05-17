import { Query, QueryOrder } from '@cubejs-client/core';

// Normalize the `order` field from cubejs's [field, direction][] array form
// into the record form the QueryBuilder expects downstream. Pre-fix this
// was an in-place mutation hidden behind the deep-clone at the boundary;
// returning a fresh object makes the contract explicit so the clone can
// be dropped (C5/H8 audit).
export function prepareQuery(query: Query): Query {
  if (Array.isArray(query.order)) {
    const orderMap = query.order.reduce(
      (acc, order) => {
        acc[order[0]] = order[1];
        return acc;
      },
      {} as Record<string, QueryOrder>
    );
    return { ...query, order: orderMap };
  }
  return query;
}
