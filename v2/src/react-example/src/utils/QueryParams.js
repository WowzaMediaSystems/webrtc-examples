/*
 * Query string read and write with the built-in URLSearchParams. A repeated key yields its
 * last value, not an array; every parameter here is a single setting.
 */

/** Every parameter in the current URL, as a plain object. */
export const readQueryParams = (search = window.location.search) =>
  Object.fromEntries(new URLSearchParams(search));

/** A URL with these parameters; null and undefined are dropped, not written as strings. */
export const buildUrlWithParams = (baseUrl, params) => {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null) search.set(key, value);
  });
  const query = search.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
};
