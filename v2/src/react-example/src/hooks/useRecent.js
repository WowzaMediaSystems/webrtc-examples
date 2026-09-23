import { useCallback, useState } from 'react';

import { forgetValue, readRecent, rememberValue } from '../utils/RecentValues';

/*
 * The remembered values for one field. Local storage is the single source of truth, re-read
 * on every render; the counter holds no data and only forces a render after a write.
 * `scope` is the transport for the signaling URL (a separate list), null otherwise.
 */
const useRecent = (field, scope = null) => {
  const [, setRevision] = useState(0);
  const values = readRecent(field, scope);

  const remember = useCallback((value) => {
    rememberValue(field, value, scope);
    setRevision((n) => n + 1);
  }, [field, scope]);

  const forget = useCallback((value) => {
    forgetValue(field, value, scope);
    setRevision((n) => n + 1);
  }, [field, scope]);

  return { values, remember, forget };
};

export default useRecent;
