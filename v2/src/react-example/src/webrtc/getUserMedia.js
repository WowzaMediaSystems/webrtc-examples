const getUserMedia = (constraints) => {
  return new Promise((resolve,reject) => {

    if (navigator.mediaDevices.getUserMedia) {

      navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => { resolve(stream); })
        .catch((error)=> {
          reject(error);
        });

    } else if (navigator.getUserMedia) {

      navigator.getUserMedia(
        constraints, 
        (stream) => { resolve(stream); },
        (error) => { reject(error); }
      );

    } else {
      reject({message:"Your browser does not support WebRTC"});
    }

  });
}
export default getUserMedia;