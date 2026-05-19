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
import { EditorView } from './editor/editor-view';

export function SegmentsPage(): ReactElement {
  return (
    <Switch>
      <Route exact path="/segments" component={LibraryView} />
      <Route exact path="/segments/identity-map" component={IdentityMapSection} />
      <Route exact path="/segments/new" component={EditorView} />
      <Route exact path="/segments/:id/edit" component={EditorView} />
      <Route path="/segments/:id" component={DetailView} />
    </Switch>
  );
}

export default SegmentsPage;
