import React, { useEffect, useId, useRef, useState } from 'react';

/*
 * A text field that offers what was used before, without a <datalist>.
 *
 * The datalist it replaces could not be styled at all: the browser draws that popup itself,
 * at its own size, in its own colours, which in a 300px panel of 34px controls read as a
 * different application. This draws the list, so it matches the panel and a row is a row
 * high rather than three.
 *
 * It stays a plain text input: the suggestions are offered, never imposed, and a value that
 * has never been used before is typed straight over them. That is the one property of the
 * datalist worth keeping, and a <select> does not have it.
 *
 * The list is not opened by focus alone. Tabbing through the panel should not throw a popup
 * over the next three fields. It opens on the chevron, on ArrowDown, and while typing when
 * something matches.
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
  /*
   * Filtered by what is typed, but not by whether it equals what is typed. Hiding the exact
   * match means the chevron does nothing at all when the field already holds the one thing
   * that has ever been used, which reads as broken rather than as tidy.
   */
  const matches = suggestions.filter((v) => v.toLowerCase().includes(text.toLowerCase()));
  const shown = open && !disabled && matches.length > 0;
  // A highlight left over from a longer list would select the wrong row on the next Enter.
  const highlighted = active < matches.length ? active : -1;

  const close = () => { setOpen(false); setActive(-1); };

  /*
   * Closed by a click anywhere else rather than by blur. Blur fires before the click that
   * caused it lands, so closing there would unmount the row being clicked.
   */
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
            >
              {/* mousedown, not click: the input blurs first and the row would be gone. */}
              <span className="wz-recent__value" onMouseDown={() => choose(suggestion)}>
                {suggestion}
              </span>
              {onForget && (
                <button
                  type="button"
                  className="wz-recent__forget"
                  tabIndex={-1}
                  aria-label={`Forget ${suggestion}`}
                  onMouseDown={(e) => { e.preventDefault(); onForget(suggestion); }}
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
