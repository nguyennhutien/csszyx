import { readChecksumAttribute, verifyMangleChecksumAsync } from '@csszyx/runtime';
import { useEffect, useState } from 'react';

/**
 * Recomputes the page's mangle checksum in the browser, the way an app that
 * wants the check calls it, and shows the answer for the CSP e2e suite.
 */
export function IntegrityFixture() {
  const [state, setState] = useState('pending');

  useEffect(() => {
    const checksum = readChecksumAttribute(document.documentElement);
    if (checksum === undefined) {
      setState('no-checksum');
      return;
    }
    verifyMangleChecksumAsync(checksum).then(ok => setState(ok ? 'verified' : 'failed'));
  }, []);

  return (
    <p data-testid="integrity" data-state={state} sz={{ p: 4 }}>
      Mangle checksum: {state}
    </p>
  );
}
