import React from 'react';
import { useSelector } from 'react-redux';

/*
 * Per-rendition readout for a simulcast publish. An idle layer is normal (Chromium drops
 * encodings bandwidth will not carry), so the reason is shown beside it.
 *
 * Rungs are ordered from the configuration, highest first: the browser omits
 * scaleResolutionDownBy on outbound-rtp, so an idle rung has no size to rank by.
 */

const fmt = (value, digits = 0, suffix = '') =>
  value === null || value === undefined || Number.isNaN(value)
    ? '\u2014'
    : `${value.toFixed(digits)}${suffix}`;

const SimulcastLayers = ({ layers, totalKbps }) => {
  const renditions = useSelector((state) => state.publishSettings.simulcastRenditions);

  if (!Array.isArray(layers) || layers.length < 2) return null;

  // Highest rung first: the smallest scale-down factor is the largest picture.
  const ladder = Array.isArray(renditions)
    ? [...renditions].sort((a, b) => Number(a.scaleResolutionDownBy) - Number(b.scaleResolutionDownBy))
        .map((r) => r.rid)
    : [];

  const rank = (rid) => {
    const index = ladder.indexOf(rid);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const ordered = [...layers].sort((a, b) => {
    if (rank(a.rid) !== rank(b.rid)) return rank(a.rid) - rank(b.rid);
    // Anything the configuration does not name falls back to picture size, largest first.
    const size = (l) => (l.frameWidth ?? 0) * (l.frameHeight ?? 0);
    return size(b) - size(a);
  });

  const sending = layers.filter((l) => l.sending).length;

  return (
    <div className="wz-layers" id="simulcast-layers">
      <div className="wz-layers__head">
        <span className="wz-layers__title">Simulcast layers</span>
        <span className="wz-layers__summary">
          {sending} of {layers.length} sending
          {totalKbps ? ` \u00b7 ${fmt(totalKbps, 0, ' kbps')} total` : ''}
        </span>
      </div>

      <table className="wz-layers__table">
        <thead>
          <tr>
            <th scope="col">RID</th>
            <th scope="col">Size</th>
            <th scope="col">Rate</th>
            <th scope="col">FPS</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((layer) => (
            <tr key={layer.rid} className={layer.sending ? '' : 'wz-layers__row--idle'}>
              <th scope="row">{layer.rid}</th>
              <td>
                {layer.frameWidth && layer.frameHeight
                  ? `${layer.frameWidth}\u00d7${layer.frameHeight}`
                  : '\u2014'}
              </td>
              <td>{fmt(layer.kbps, 0, ' kbps')}</td>
              <td>{layer.framesPerSecond ? Math.round(layer.framesPerSecond) : '\u2014'}</td>
              <td>
                {layer.sending
                  ? <span className="wz-layers__state wz-layers__state--on">sending</span>
                  : (
                    <span
                      className="wz-layers__state wz-layers__state--off"
                      title={layer.limitedBy
                        ? `The browser is not encoding this layer; it reports ${layer.limitedBy} as the limit.`
                        : 'Configured, but the browser is not encoding it.'}
                    >
                      {layer.limitedBy ? `idle (${layer.limitedBy})` : 'idle'}
                    </span>
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default SimulcastLayers;
