import Cookies from 'js-cookie';

export const getCookieValues = (cookieName) => {
  let cookieValues = {};
  let cookieString = Cookies.get(cookieName);
  if (cookieString != null)
    cookieValues = JSON.parse(unescape(cookieString));
  return cookieValues;
}

export const setCookieValues = (cookieName, values) => {
  Cookies.set(cookieName,escape(JSON.stringify(values)));
}