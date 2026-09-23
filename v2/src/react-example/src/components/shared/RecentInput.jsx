import React, { useEffect, useId, useRef, useState } from 'react';

/*
 * A text field offering previously used values in a panel-styled list (a <datalist> popup
 * cannot be styled). Still a plain input: new values are typed straight over suggestions.
 * Focus alone does not open it; the chevron, ArrowDown, or a matching keystroke does.
 */
const RecentInput = ({
  label,
  id,
  value,
  suggestions = [],
  onChange,
  onForget = null,
  disabled = false,
  hint = null,
  ...inputProps
}) => {
  const listId = `${id}-recent`;
  const generatedId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);

  const text = value || '';
  // Exact matches stay listed, or the chevron does nothing when the field holds the only value.
  const matches = suggestions.filter((v) => v.toLowerCase().includes(text.toLowerCase()));
  const shown = open && !disabled && matches.length > 0;
  // A highlight left over from a longer list would select the wrong row on the next Enter.
  const highlighted = active < matches.length ? active : -1;

  const close = () => { setOpen(false); setActive(-1); };

  // Closed on outside pointerdown, not blur: blur fires before the click lands and would
  // unmount the row being clicked.
  useEffect(() => {
    if (!shown) return undefined;
    const onDocument = (event) => {
      if (!wrapRef.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', onDocument);
    return () => document.removeEventListener('pointerdown', onDocument);
  }, [shown]);

  const choose = (suggestion) => {
    onChange(suggestion);
    close();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key === 'ArrowDown' && !shown) {
      setOpen(true);
      return;
    }
    if (!shown) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => {
        const next = i + step;
        if (next < 0) return matches.length - 1;
        if (next >= matches.length) return 0;
        return next;
      });
    } else if (event.key === 'Enter' && highlighted >= 0) {
      // Only when a row is highlighted, so Enter on a typed value still submits the form.
      event.preventDefault();
      choose(matches[highlighted]);
    } else if (event.key === 'Delete' && highlighted >= 0 && onForget) {
      // The × beside a row is a mouse target only. This is the same action for a keyboard.
      event.preventDefault();
      onForget(matches[highlighted]);
    } else if (event.key === 'Tab') {
      close();
    }
  };

  return (
    <div className="mb-3 wz-recent" ref={wrapRef}>
      <label htmlFor={id}>{label}</label>
      <div className="wz-recent__control">
        <input
          type="text"
          className="form-control"
          id={id}
          name={id}
          value={text}
          disabled={disabled}
          role="combobox"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted >= 0 ? `${generatedId}-${highlighted}` : undefined}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          {...inputProps}
        />
        {suggestions.length > 0 && !disabled && (
          <button
            type="button"
            className="wz-recent__toggle"
            id={`${id}-recent-toggle`}
            tabIndex={-1}
            aria-label={`Recently used ${label}`}
            onClick={() => (shown ? close() : setOpen(true))}
          >
            <span aria-hidden="true">▾</span>
          </button>
        )}
      </div>

      {shown && (
        <ul className="wz-recent__list" id={listId} role="listbox" aria-label={`Recently used ${label}`}>
          {matches.map((suggestion, index) => (
            <li
              key={suggestion}
              id={`${generatedId}-${index}`}
              role="option"
              /* Named explicitly, so the × inside the row is not read as part of the value. */
              aria-label={suggestion}
              aria-selected={index === highlighted}
              className={index === highlighted ? 'wz-recent__row is-active' : 'wz-recent__row'}
              onMouseEnter={() => setActive(index)}
              /* mousedown, not click: the input blurs first and the row would be gone. */
              onMouseDown={() => choose(suggestion)}
            >
              <span className="wz-recent__value">
                {suggestion}
              </span>
              {onForget && (
                <button
                  type="button"
                  className="wz-recent__forget"
                  tabIndex={-1}
                  aria-label={`Forget ${suggestion}`}
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onForget(suggestion); }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {hint}
    </div>
  );
};

export default RecentInput;
