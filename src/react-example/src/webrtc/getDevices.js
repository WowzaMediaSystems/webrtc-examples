const getDevices = () => {
  return new Promise((resolve,reject) => {

    navigator.mediaDevices.enumerateDevices()
    .then((devices) => {

      let resolveObj = { cameras:[], microphones:[] };

      for (var i = 0; i < devices.length; i++) {
        if (devices[i].kind === 'videoinput') {
          resolveObj.cameras.push(devices[i]);
        } else if (devices[i].kind === 'audioinput') {
          resolveObj.microphones.push(devices[i]);
        }
      }
      resolve(resolveObj);
    })
    .catch((e) => {
        reject(e);
    });

  });
}
export default getDevices;