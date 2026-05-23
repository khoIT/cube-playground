import { useEffect, useLayoutEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';

import { useIsMounted, usePlaygroundContext } from '../../hooks';

export function IndexPage() {
  const { push } = useHistory();
  const isMounted = useIsMounted();
  const context = usePlaygroundContext();

  const [files, setFiles] = useState<any[] | null>(null);

  useEffect(() => {
    async function loadFiles() {
      try {
        const res = await fetch('playground/files');
        if (!res.ok) {
          // Production-style Cube backend: /playground/files does not exist.
          if (isMounted()) setFiles([]);
          return;
        }
        const result = await res.json();
        if (result.error?.includes('Model files not found')) {
          setFiles([]);
        } else if (result.error) {
          throw result.error;
        }
        if (isMounted()) {
          setFiles(result.files ?? []);
        }
      } catch {
        if (isMounted()) setFiles([]);
      }
    }

    loadFiles();
  }, []);

  // Routing policy:
  // - dev Cube server with model files (>1, or non-Orders.js stub) → /build
  // - empty / 404 / stub-only → /build (Playground is the chosen landing)
  // - connection wizard flag (Cube Cloud) → /connection
  useLayoutEffect(() => {
    if (context && files != null) {
      if (context.shouldStartConnectionWizardFlow) {
        push('/connection');
      } else {
        push('/build');
      }
    }
  }, [context, files]);

  return null;
}
