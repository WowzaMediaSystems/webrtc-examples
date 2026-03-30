export const isValidStunUrl = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'stun:';
  } catch {
    return false;
  }
}

export const addStunServer = (settings, session) => {
  const peerConnectionConfig = session.peerConnectionConfig;
  if (settings.stunServerURL !== '') {
    const urls = settings.stunServerURL.split(',').map(url => url.trim()).filter(Boolean);
    urls.forEach(url => {
      console.log(`STUN server URL: ${url}`);
      peerConnectionConfig.iceServers.push({ urls: url });
    });
  } else {
    console.log('No STUN server provided');
  }
}

export const STUN_SERVER_PLACEHOLDER = "stun:<host>:<port>, stun:<host>:<port>";