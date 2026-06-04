/**
 * FeatureRouteGuard — URL-level enforcement of feature access.
 *
 * Mounted once inside the router (sibling of the route table). On every
 * location change it maps the path to its gating FeatureKey; if the user lacks
 * that feature it redirects to `/settings` — a non-feature route that is always
 * reachable, so there's no redirect loop even when the landing feature (chats)
 * is itself disabled. The `admin` surface is excluded here (its role guard owns
 * the redirect). This stops direct-URL access to disabled surfaces; the server
 * remains the authority for data.
 */

import { ReactElement } from 'react';
import { Redirect, useLocation } from 'react-router-dom';

import { useHasFeature, featureForRoute } from './feature-access';

export function FeatureRouteGuard(): ReactElement | null {
  const { pathname } = useLocation();
  const hasFeature = useHasFeature();
  const key = featureForRoute(pathname);
  if (key && !hasFeature(key)) {
    return <Redirect to="/settings" />;
  }
  return null;
}

export default FeatureRouteGuard;
