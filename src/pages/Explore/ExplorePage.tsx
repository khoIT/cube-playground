import { useHistory } from 'react-router-dom';
import { validateQuery } from '@cubejs-client/core';

import { QueryBuilderContainer } from '../../components/PlaygroundQueryBuilder/QueryBuilderContainer';
import { useAppContext, useCubeApiBootstrap } from '../../hooks';
import { PerfProbe } from '../../dev/perf-probe';

export function ExplorePage() {
  const { push } = useHistory();
  const { schemaVersion } = useAppContext();

  useCubeApiBootstrap();

  function setQueryParam({ query }: { query?: Object }) {
    if (query) {
      push({ search: `?query=${JSON.stringify(validateQuery(query))}` });
    }
  }

  return (
    <PerfProbe id="ExplorePage">
      <QueryBuilderContainer
        schemaVersion={schemaVersion}
        onQueryChange={setQueryParam}
        onTabChange={setQueryParam}
      />
    </PerfProbe>
  );
}
