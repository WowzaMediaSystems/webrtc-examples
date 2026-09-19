import React, { useState } from 'react';

const CollapsibleSection = ({ title, children }) => {

  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="row mb-2">
        <div className="col-12">
          <button
            type="button"
            className="btn btn-sm w-100 d-flex align-items-center justify-content-between btn-drawer-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            <span>{title}</span>
            <i className={`bi bi-chevron-${expanded ? 'up' : 'down'}`}></i>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border border-top-0 rounded-bottom p-3 mb-3">
          {children}
        </div>
      )}
    </>
  );
}

export default CollapsibleSection;
