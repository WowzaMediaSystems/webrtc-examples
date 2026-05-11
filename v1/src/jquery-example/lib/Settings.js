/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 */

const cookieName = "webrtcValues";

const serializeArrayFormValues = function (formNode) {
  let disabled = formNode.find(":input:disabled").removeAttr("disabled");
  let serialized = formNode.serializeArray();
  disabled.attr("disabled", "disabled");
  return serialized;
};


const saveToCookie = (valuesObject) => {
  let cookieValue = Cookies.get(cookieName);
  if (cookieValue == null) cookieValue = '{}';
  let cookieObject = JSON.parse(unescape(cookieValue));
  let saveObject = {...cookieObject,...valuesObject};
  Cookies.set(cookieName,escape(JSON.stringify(saveObject)));
}

const mapFromCookie = (initialStateObject) => {
  let state = {...initialStateObject};
  let cookieValue = Cookies.get(cookieName);
  if (cookieValue == null) cookieValue = '{}';
  let cookieObject = JSON.parse(unescape(cookieValue));
  for (let key in cookieObject) {
    if (state[key] != null)
      state[key] = cookieObject[key];
  };
  return state;
}

const mapFromQueryParams = (initialStateObject) => {
  let state = {...initialStateObject};
  for (let [key, value] of Object.entries(initialStateObject)) {
    state[key] = getQueryVariable(key,state[key]);
  }
  return state;
}

const mapFromForm = (formValueArray) => {
  let state = {};
  for(var i = 0; i < formValueArray.length; i++){
    state[formValueArray[i].name] = formValueArray[i].value;
  }
  return state;
}

const updateForm = (state) => {
  for (let [key, value] of Object.entries(state)) {
    $(`#${key}`).val(state[key]);
  }
}

const getQueryVariable = (variable,defaultVal,isString = false) => {
   var query = window.location.search.substring(1);
   var vars = query.split('&');
   for (var i = 0; i < vars.length; i++)
   {
      var pair = vars[i].split('=');
      if (decodeURIComponent(pair[0]) == variable)
      {
         return isString ? decodeURIComponent(pair[1].replace(/\+/g, '%20')) : decodeURIComponent(pair[1]);
      }
   }
   return defaultVal;
}

const shareLink = (settings,message) => {
  let queryParams = $.param(settings);
  let baseUrl = window.location.href.split('#');
  let anchor = baseUrl[1] ? '#'+baseUrl[1] : '';
  baseUrl = baseUrl[0].split('?')[0]; //toss existing query params
  copyTextToClipboard(baseUrl+'?'+queryParams+anchor,message);
}

const copyTextToClipboard = (text,message) => {
  if(text === null || text === undefined || text.length == 0){
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


let Settings = {
  serializeArrayFormValues: serializeArrayFormValues,
  saveToCookie: saveToCookie,
  mapFromCookie: mapFromCookie,
  mapFromQueryParams: mapFromQueryParams,
  mapFromForm: mapFromForm,
  updateForm: updateForm,
  getQueryVariable: getQueryVariable,
  shareLink: shareLink
}
export default Settings;
