import { describe, it, expect } from 'vitest';
import { isValidIpAddress } from './IpAddressUtils';

describe('isValidIpAddress', () => {
  it('accepts ordinary IPv4', () => {
    expect(isValidIpAddress('192.168.1.1')).toBe(true);
    expect(isValidIpAddress('8.8.8.8')).toBe(true);
    expect(isValidIpAddress('255.255.255.255')).toBe(true);
    expect(isValidIpAddress('0.0.0.0')).toBe(true);
  });

  it('trims surrounding whitespace before judging', () => {
    expect(isValidIpAddress('  10.0.0.1  ')).toBe(true);
  });

  it('rejects an octet above 255', () => {
    expect(isValidIpAddress('192.168.1.256')).toBe(false);
    expect(isValidIpAddress('300.1.1.1')).toBe(false);
  });

  it('rejects the wrong number of octets', () => {
    expect(isValidIpAddress('192.168.1')).toBe(false);
    expect(isValidIpAddress('192.168.1.1.1')).toBe(false);
  });

  // A leading zero is read as octal by some resolvers, so it is not the address it looks like.
  it('rejects leading zeros', () => {
    expect(isValidIpAddress('192.168.01.1')).toBe(false);
  });

  it('rejects anything that is not just an address', () => {
    expect(isValidIpAddress('192.168.1.1:8080')).toBe(false);
    expect(isValidIpAddress('192.168.1.0/24')).toBe(false);
    expect(isValidIpAddress('http://192.168.1.1')).toBe(false);
    expect(isValidIpAddress('localhost')).toBe(false);
    expect(isValidIpAddress('')).toBe(false);
    expect(isValidIpAddress(null)).toBe(false);
  });

  it('accepts IPv6, including the compressed and IPv4-mapped forms', () => {
    expect(isValidIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
    expect(isValidIpAddress('2001:db8::8a2e:370:7334')).toBe(true);
    expect(isValidIpAddress('::1')).toBe(true);
    expect(isValidIpAddress('::ffff:192.168.1.1')).toBe(true);
  });

  it('rejects malformed IPv6', () => {
    expect(isValidIpAddress('2001:db8::8a2e::7334')).toBe(false);
    expect(isValidIpAddress('2001:db8:85a3:0:0:8a2e:370')).toBe(false);
    expect(isValidIpAddress('[2001:db8::1]')).toBe(false);
    expect(isValidIpAddress('fe80::1%eth0')).toBe(false);
    expect(isValidIpAddress('gggg::1')).toBe(false);
  });
});
