/*
 * Reading and writing the query string, with URLSearchParams.
 *
 * This replaced the query-string package, which was 6.4 KB of the bundle (with its
 * decode-uri-component dependency) to do what the platform has done natively for years.
 * In an example other people copy, the built-in is also the thing worth showing.
 *
 * One difference worth stating: query-string returns an array when a key appears more than
 * once, and this returns the last value. Every parameter here is a single setting, and a
 * share link never repeats one, so there is nothing to collect.
 */

/** Every parameter in the current URL, as a plain object. */
export const readQueryParams = (search = window.location.search) =>
  Object.fromEntries(new URLSearchParams(search));

/**
 * A URL with these parameters on it.
 *
 * Null and undefined are dropped rather than written as the strings "null" and "undefined",
 * which is what URLSearchParams does with them if they are handed straight over.
 */
export const buildUrlWithParams = (baseUrl, params) => {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null) search.set(key, value);
  });
  const query = search.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
};
