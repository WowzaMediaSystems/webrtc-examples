/*
 * Client IP validation for the secure-token fields. The Engine wants a bare address (no
 * port, CIDR suffix, scheme or brackets); IPv4 and IPv6 are both accepted.
 */

// Rejects leading zeros ("192.168.01.1"), which some resolvers read as octal.
const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;

export const isValidIpv4 = (value) => {
  const parts = String(value).split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => IPV4_OCTET.test(part) && Number(part) <= 255);
};

export const isValidIpv6 = (value) => {
  const text = String(value);

  // No zone id, no brackets, no port: the Engine wants the address on its own.
  if (/[[\]%]/.test(text)) return false;
  if (!text.includes(':')) return false;

  // At most one "::", and it is the only way a group may be empty.
  const doubleColons = text.split('::').length - 1;
  if (doubleColons > 1) return false;

  const halves = text.split('::');
  const groups = halves.map((half) => (half === '' ? [] : half.split(':')));
  const flat = groups.flat();

  // A trailing IPv4 form ("::ffff:192.168.1.1") counts as two groups.
  let count = flat.length;
  const last = flat[flat.length - 1];
  if (last !== undefined && last.includes('.')) {
    if (!isValidIpv4(last)) return false;
    count += 1;
  }

  const hextets = last !== undefined && last.includes('.') ? flat.slice(0, -1) : flat;
  if (!hextets.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return false;

  return doubleColons === 1 ? count <= 7 : count === 8;
};

export const isValidIpAddress = (value) => {
  const text = String(value ?? '').trim();
  if (text === '') return false;
  return text.includes(':') ? isValidIpv6(text) : isValidIpv4(text);
};

export const IP_ADDRESS_PLACEHOLDER = '203.0.113.42';
