import React from 'react';
import QueryString from 'query-string';
import fileImage from '../../images/file_copy-24px.svg'

const ShareLink = (props) => {

  const settings= props.settings;
  const parameters = props.parameters;
  const prefix = props.prefix;

  const copyTextToClipboard = (text,message) => {
    if(text === null || text === undefined || text.length === 0){
      alert("Copy failed :(")
      return
    }

    navigator.clipboard.writeText(text).then(() => {
      showAlert()
    }, () => {
      /* clipboard write failed do it the ugly way */
      text.select();
      document.execCommand("copy");
      showAlert();
    });

    const showAlert = () => {
      if(message){
        alert(message);
      }else{
        alert("Copied!")
      }
    }
  }

  const getLink = (e) => {
    let queryParams = {};
    for (let i = 0; i < parameters.length; i++)
    {
      if (settings[parameters[i]] != null)
      {
        queryParams[prefix+parameters[i]] = settings[parameters[i]];
      }
    }

    let baseUrl = window.location.origin + window.location.pathname;
    let qs = QueryString.stringifyUrl({url:baseUrl,query:queryParams});
    copyTextToClipboard(qs);
  }

  return (
    <button id={prefix+"-share-link"} type="button" className="control-button mt-0" onClick={getLink}>
      <img alt="" className="noll" id={prefix+"-share-img"}  src={fileImage}/>
    </button>
  );
}

export default ShareLink;
