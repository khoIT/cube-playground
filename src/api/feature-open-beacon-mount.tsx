/**
 * Mounts the feature-open beacon: watches the router location and fires one
 * `feature_open` event when the active feature surface changes. Deduped per
 * feature key for the session so in-feature navigation (e.g. switching catalog
 * tabs) doesn't spam the spine. Renders nothing.
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { featureForPath, recordFeatureOpen } from './feature-open-beacon';

export function FeatureOpenBeacon(): null {
  const location = useLocation();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    const feature = featureForPath(location.pathname);
    if (!feature || feature === lastSent.current) return;
    lastSent.current = feature;
    recordFeatureOpen(feature);
  }, [location.pathname]);

  return null;
}
