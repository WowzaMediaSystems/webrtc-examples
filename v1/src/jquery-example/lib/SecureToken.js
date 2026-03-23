/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 */

/* This is an example of how to generate a hash to send to getOffer in the JSON package.
   This code should actually be on a web server and all the inputs to this method (secureTokenData) 
   should be determined on the server side so that the web user doesn't see the prefix or secret in particular.
   The values of prefix, secret and isIp are set based on configuration of "Playback Security" in Wowza Streaming Engine for the application
   This is hard coded to use the SHA-256 hashing algorithm which is also set in Playback Security.
   The return value of getSecureToken() is all that the web client should see.
   More info here: https://www.wowza.com/docs/How-to-protect-streaming-using-SecureToken-in-Wowza-Streaming-Engine#hls-example
   */
   

/*
let mySecureTokenData = {
  prefix: 'wowzaprefix',
  secret: 'mysecret',
  timeout: 10, // seconds
  isIp: true,
  ip: '127.0.0.1',
  applicationName: 'live',
  streamName: 'myStream'
  };
*/

const getSecureToken = async (secureTokenData) => { 
  console.log("Token data" + JSON.stringify(secureTokenData));
  if (secureTokenData.secret) {
    let prefix = secureTokenData.prefix;
    if(prefix === undefined || prefix === "") {
      prefix = 'wowzatoken' //the WSE default
    }    
	  let url = secureTokenData.applicationName + '/' + secureTokenData.streamName + "?";
	  // add query parameters in alphabetical order.
    let queryParams = [];
    queryParams.push(secureTokenData.secret);
	  if (secureTokenData.isIp) {
      queryParams.push(secureTokenData.ip);
	  }
	  if (secureTokenData.timeout > 0) {
	    let currTime = Math.trunc(new Date().getTime() / 1000);
	    secureTokenData.startTime = (currTime - 5).toString();
	    secureTokenData.endTime = (currTime + Math.trunc(secureTokenData.timeout)).toString();
      queryParams.push(prefix + "endtime=" + secureTokenData.endTime);
      queryParams.push(prefix + "starttime=" + secureTokenData.startTime);
	  }
    queryParams.sort();
    url = url + queryParams.join("&");
	  console.log("URL to hash: " + url);
	  let vDigest = await digestMessage(url);
	  return { hash : vDigest, starttime : secureTokenData.startTime, endtime : secureTokenData.endTime }
  }
  return null;
}

async function digestMessage(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  let hashb64 = btoa(new Uint8Array(hash).reduce((data, byte) => data + String.fromCharCode(byte), ''));
  hashb64 = hashb64.replaceAll('/', '_');
  hashb64 = hashb64.replaceAll('+', '-');
  return hashb64;
}
export default getSecureToken;
