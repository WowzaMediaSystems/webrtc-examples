import { describe, expect, it } from 'vitest';

import { validateParams } from './ValidationUtils';
import { addIceServers, isValidStunUrl, isValidTurnUrl } from './IceServersUtils';

describe('validateParams', () => {
  it('accepts a settings object with both required names', () => {
    expect(() => validateParams({ applicationName: 'webrtc', streamName: 'myStream' })).not.toThrow();
  });

  it('rejects an empty application name', () => {
    expect(() => validateParams({ applicationName: '', streamName: 'myStream' }))
      .toThrow('Application name required');
  });

  it('rejects an empty stream name', () => {
    expect(() => validateParams({ applicationName: 'webrtc', streamName: '' }))
      .toThrow('Stream name required');
  });
});

describe('ICE server URL validation', () => {
  it('accepts a stun: URL', () => {
    expect(isValidStunUrl('stun:stun.example.com:3478')).toBe(true);
  });

  it('rejects a turn: URL as a STUN URL', () => {
    expect(isValidStunUrl('turn:turn.example.com:3478')).toBe(false);
  });

  it('accepts both turn: and turns: URLs', () => {
    expect(isValidTurnUrl('turn:turn.example.com:3478')).toBe(true);
    expect(isValidTurnUrl('turns:turn.example.com:5349')).toBe(true);
  });

  it('rejects anything that is not a URL', () => {
    expect(isValidStunUrl('not a url')).toBe(false);
    expect(isValidTurnUrl('')).toBe(false);
  });
});

describe('addIceServers', () => {
  const newSession = () => ({ peerConnectionConfig: { iceServers: [] } });

  it('adds nothing when both fields are empty', () => {
    const session = newSession();
    addIceServers({ stunServerURL: '', turnServerURL: '' }, session);
    expect(session.peerConnectionConfig.iceServers).toEqual([]);
  });

  it('splits a comma-separated STUN list and trims each entry', () => {
    const session = newSession();
    addIceServers(
      { stunServerURL: 'stun:a.example.com:3478, stun:b.example.com:3478', turnServerURL: '' },
      session
    );
    expect(session.peerConnectionConfig.iceServers).toEqual([
      { urls: 'stun:a.example.com:3478' },
      { urls: 'stun:b.example.com:3478' },
    ]);
  });

  it('carries the credentials through on a TURN entry', () => {
    const session = newSession();
    addIceServers(
      {
        stunServerURL: '',
        turnServerURL: 'turn:turn.example.com:3478',
        turnUsername: 'user',
        turnPassword: 'secret',
      },
      session
    );
    expect(session.peerConnectionConfig.iceServers).toEqual([
      { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'secret' },
    ]);
  });
});
