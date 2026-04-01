export const isValidStunUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'stun:';
  } catch {
    return false;
  }
}

export const isValidTurnUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'turn:' || parsed.protocol === 'turns:';
  } catch {
    return false;
  }
}


export const addIceServers = (settings, session) => {
  const { iceServers } = session.peerConnectionConfig;

  if (settings.stunServerURL !== '') {
    settings.stunServerURL
      .split(',').map(url => url.trim()).filter(Boolean)
      .forEach(url =>  {
        iceServers.push({ urls: url });
        console.log(`STUN server URL: ${url}`);
      });
  }

  if (settings.turnServerURL !== '') {
    settings.turnServerURL
      .split(',').map(url => url.trim()).filter(Boolean)
      .forEach(url => {
        iceServers.push({
          urls: url,
          username: settings.turnUsername,
          credential: settings.turnPassword
        });
        console.log(`TURN server URL: ${url}`);
      });
  }

  console.log(`Session: ${JSON.stringify(session)}`);
}

export const STUN_SERVER_PLACEHOLDER = "stun:<host>:<port>, stun:<host>:<port>";
export const TURN_SERVER_PLACEHOLDER = "turn:<host>:<port>";