import { useRef, useEffect } from 'react';
import { useSelector } from 'react-redux';

const useMediaStream = () => {
  const { stream } = useSelector((state) => state.media);
  const streamRef = useRef(stream);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  return streamRef;
};

export default useMediaStream;