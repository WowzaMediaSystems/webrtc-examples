const getDisplayStream = () => {
  return new Promise ((resolve, reject) => {

    function getDisplaySuccess (stream) {
      resolve(stream);
    };

    let constraints = {video:true};

    if (navigator.getDisplayMedia) {

      navigator.getDisplayMedia(constraints)
      .then((stream) => { getDisplaySuccess(stream); })
      .catch((e) => { reject(e); });

    } else if (navigator.mediaDevices.getDisplayMedia) {

      navigator.mediaDevices.getDisplayMedia(constraints)
      .then((stream) => { getDisplaySuccess(stream); })
      .catch((e) => { reject(e); });

    } else {

      constraints = {video: {mediaSource: 'screen'}};
      navigator.mediaDevices.getUserMedia(constraints)
      .then((stream) => { getDisplaySuccess(stream); })
      .catch((e) => { reject(e); });

    }
  });
}
export default getDisplayStream;