import { useCallback, useState } from 'react';

import { forgetValue, readRecent, rememberValue } from '../utils/RecentValues';

/*
 * The remembered values for one field.
 *
 * Local storage is the store; this only decides when to read it again. The list used to be
 * read straight from local storage during render, which worked only because something else
 * happened to re-render at the right moment. Forgetting an entry has no such luck: it
 * changes storage and nothing else.
 *
 * The counter holds no data and is never read: storage is the single source of truth and
 * the list is re-read on every render. Bumping it exists only to ask for that render, which
 * is less machinery than keeping a second copy in state and keeping the two in step.
 *
 * `scope` is the transport for the signalling URL and null for everything else. Changing it
 * swaps the list rather than filtering one, because they are separate lists.
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
