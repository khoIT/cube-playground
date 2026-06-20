/**
 * Segments workspace entry. Switches between Library list and Detail view based
 * on the current URL. Mounted via KeepAliveRoute so internal state survives
 * navigation to sibling tabs.
 */

import { ReactElement } from 'react';
import { Route, Switch } from 'react-router-dom';
import { LibraryView } from './library/library-view';
import { DetailView } from './detail/detail-view';
import { IdentityMapSection } from './identity-map/identity-map-section';
import { SnapshotCoveragePage } from './snapshot-coverage';
import { CompareView } from './compare/compare-view';
import { EditorView } from './editor/editor-view';
import { FunnelBuilder } from './funnel-builder';
import { Member360View } from './member360/member-360-view';
import { CareHistory360Page } from './member360/care-history-360/care-history-360-page';
import { useCubeApiBootstrap } from '../../hooks';

export function SegmentsPage(): ReactElement {
  // Push apiUrl + token into AppContext so preset cards can hit Cube
  // directly even when the user lands on /segments without visiting /build.
  useCubeApiBootstrap();

  return (
    <Switch>
      <Route exact path="/segments" component={LibraryView} />
      <Route exact path="/segments/identity-map" component={IdentityMapSection} />
      <Route exact path="/segments/snapshot-coverage" component={SnapshotCoveragePage} />
      <Route exact path="/segments/compare" component={CompareView} />
      {/* /segments/new/funnel must come before /segments/new to avoid partial match */}
      <Route exact path="/segments/new/funnel" component={FunnelBuilder} />
      <Route exact path="/segments/new" component={EditorView} />
      <Route exact path="/segments/:id/edit" component={EditorView} />
      {/* CS Care History 360 (Care-tab drill) — more specific, precedes /members/:uid */}
      <Route exact path="/segments/:id/members/:uid/care" component={CareHistory360Page} />
      {/* Per-member 360 — must precede the catch-all detail route below */}
      <Route exact path="/segments/:id/members/:uid" component={Member360View} />
      <Route path="/segments/:id" component={DetailView} />
    </Switch>
  );
}

export default SegmentsPage;
