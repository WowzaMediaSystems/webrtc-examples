const GO_BUTTON_START = "Publish";
const GO_BUTTON_STOP = "Stop";

var localVideo = null;
var remoteVideo = null;
var peerConnection = null;
var peerConnectionConfig = {'iceServers': []};
var localStream = null;
var wsURL = "wss://localhost.streamlock.net/webrtc-session.json";
var wsConnection = null;
var streamInfo = {applicationName:"webrtc", streamName:"myStream", sessionId:"[empty]"};
var userData = {param1:"value1"};
var videoBitrate = 360;
var audioBitrate = 64;
var newAPI = false;
var SDPOutput = new Object();

navigator.getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia || navigator.webkitGetUserMedia;
window.RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
window.RTCIceCandidate = window.RTCIceCandidate || window.mozRTCIceCandidate || window.webkitRTCIceCandidate;
window.RTCSessionDescription = window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription;

function pageReady()
{

    var cookieWSURL = $.cookie("webrtcPublishWSURL");
    if (cookieWSURL === undefined)
    {
		cookieWSURL = wsURL;
		$.cookie("webrtcPublishWSURL", cookieWSURL);
	}
	console.log('cookieWSURL: '+cookieWSURL);

    var cookieApplicationName = $.cookie("webrtcPublishApplicationName");
    if (cookieApplicationName === undefined)
    {
		cookieApplicationName = streamInfo.applicationName;
		$.cookie("webrtcPublishApplicationName", cookieApplicationName);
	}
	console.log('cookieApplicationName: '+cookieApplicationName);

    var cookieStreamName = $.cookie("webrtcPublishStreamName");
    if (cookieStreamName === undefined)
    {
		cookieStreamName = streamInfo.streamName;
		$.cookie("webrtcPublishStreamName", cookieStreamName);
	}
	console.log('cookieStreamName: '+cookieStreamName);
	
		var cookieVideoBitrate = $.cookie("webrtcPublishVideoBitrate");
    if (cookieVideoBitrate === undefined)
    {
		cookieVideoBitrate = videoBitrate;
		$.cookie("webrtcPublishVideoBitrate", cookieVideoBitrate);
	}
	console.log('cookieVideoBitrate: '+cookieVideoBitrate);

	var cookieAudioBitrate = $.cookie("webrtcPublishAudioBitrate");
    if (cookieAudioBitrate === undefined)
    {
		cookieAudioBitrate = audioBitrate;
		$.cookie("webrtcPublishAudioBitrate", cookieAudioBitrate);
	}
	console.log('cookieAudioBitrate: '+cookieAudioBitrate);

	$('#sdpURL').val(cookieWSURL);
	$('#applicationName').val(cookieApplicationName);
	$('#streamName').val(cookieStreamName);
	$('#videoBitrate').val(cookieVideoBitrate);
	$('#audioBitrate').val(cookieAudioBitrate);

	$("#buttonGo").attr('value', GO_BUTTON_START);

	localVideo = document.getElementById('localVideo');

	// Constraints are now set so a lower resolution is an option for video
	// It seems FireFox is very specific about constraints.
    var constraints =
    {
		video: {
			width: { min: 640, ideal: 1280, max: 1920 },
			height: { min: 480, ideal: 720, max: 1080 }
		  },
		audio: true,
    };

    if(navigator.mediaDevices.getUserMedia)
	{
		navigator.mediaDevices.getUserMedia(constraints).then(getUserMediaSuccess).catch(errorHandler);
		newAPI = false;
	}
    else if (navigator.getUserMedia)
    {
        navigator.getUserMedia(constraints, getUserMediaSuccess, errorHandler);
    }
    else
    {
        alert('Your browser does not support getUserMedia API');
    }

	console.log("newAPI: "+newAPI);

}

function wsConnect(url)
{
	wsConnection = new WebSocket(url);
	wsConnection.binaryType = 'arraybuffer';

	wsConnection.onopen = function()
	{
		console.log("wsConnection.onopen");

		peerConnection = new RTCPeerConnection(peerConnectionConfig);
		peerConnection.onicecandidate = gotIceCandidate;
		
		localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

		peerConnection.createOffer().then(description => gotDescription(description)).catch(err => errorHandler(err));

	}

	wsConnection.onmessage = function(evt)
	{
		console.log("wsConnection.onmessage: "+evt.data);

		var msgJSON = JSON.parse(evt.data);

		var msgStatus = Number(msgJSON['status']);
		var msgCommand = msgJSON['command'];

		if (msgStatus != 200)
		{
			$("#sdpDataTag").html(msgJSON['statusDescription']);
			stopPublisher();
		}
		else
		{
			$("#sdpDataTag").html("");

			var sdpData = msgJSON['sdp'];
			if (sdpData !== undefined)
			{
				console.log('sdp: '+msgJSON['sdp']);
				
				var enhanceData = new Object();

				if (audioBitrate !== undefined)
					enhanceData.audioBitrate = Number(audioBitrate);
				if (videoBitrate !== undefined)
					enhanceData.videoBitrate = Number(videoBitrate);

				sdpData.sdp = enhanceSDP(sdpData.sdp, enhanceData);

				peerConnection
					.setRemoteDescription(new RTCSessionDescription(sdpData))
					.then(() => {})
					.catch(err => errorHandler(err));
			}

			var iceCandidates = msgJSON['iceCandidates'];
			if (iceCandidates !== undefined)
			{
				for(var index in iceCandidates)
				{
					console.log('iceCandidates: ' + iceCandidates[index]);
					peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidates[index]));
				}
			}
		}

		if (wsConnection != null)
			wsConnection.close();
		wsConnection = null;
	}

	wsConnection.onclose = function()
	{
		console.log("wsConnection.onclose");
	}

	wsConnection.onerror = function(evt)
	{
		console.log("wsConnection.onerror: "+JSON.stringify(evt));

		$("#sdpDataTag").html('WebSocket connection failed: '+wsURL);
		stopPublisher();
	}
}

function getUserMediaSuccess(stream)
{
	console.log("getUserMediaSuccess: "+stream);
    localStream = stream;
	try{
		localVideo.srcObject = stream;
	} catch (error){
		localVideo.src = window.URL.createObjectURL(stream);
	}
}

function startPublisher()
{
	wsURL = $('#sdpURL').val();
	streamInfo.applicationName = $('#applicationName').val();
	streamInfo.streamName = $('#streamName').val();
	videoBitrate = $('#videoBitrate').val();
	audioBitrate = $('#audioBitrate').val();

	$.cookie("webrtcPublishWSURL", wsURL, { expires: 365 });
	$.cookie("webrtcPublishApplicationName", streamInfo.applicationName, { expires: 365 });
	$.cookie("webrtcPublishStreamName", streamInfo.streamName, { expires: 365 });
	$.cookie("webrtcPublishVideoBitrate", videoBitrate, { expires: 365 });
	$.cookie("webrtcPublishAudioBitrate", audioBitrate, { expires: 365 });

	console.log("startPublisher: wsURL:"+wsURL+" streamInfo:"+JSON.stringify(streamInfo));

	wsConnect(wsURL);

	$("#buttonGo").attr('value', GO_BUTTON_STOP);
}

function stopPublisher()
{
	if (peerConnection != null)
		peerConnection.close();
	peerConnection = null;

	if (wsConnection != null)
		wsConnection.close();
	wsConnection = null;

	$("#buttonGo").attr('value', GO_BUTTON_START);

	console.log("stopPublisher");
}

function start()
{
	if (peerConnection == null)
		startPublisher();
	else
		stopPublisher();
}

function gotIceCandidate(event)
{
    if(event.candidate != null)
    {
    	console.log('gotIceCandidate: '+JSON.stringify({'ice': event.candidate}));
    }
}

function gotDescription(description)
{
	// Uncomment to debug the SDP information

    peerConnection
    	.setLocalDescription(description)
    	.then(() => wsConnection.send('{"direction":"publish", "command":"sendOffer", "streamInfo":'+JSON.stringify(streamInfo)+', "sdp":'+JSON.stringify(description)+', "userData":'+JSON.stringify(userData)+'}'))
    	.catch(err => console.log('set description error', err));

}

function enhanceSDP(sdpStr, enhanceData)
{
	// This is a very simple enhance function.
	// We find the audio and video locations in the SDP file
	// We find the corresponding c= lines and then we add in 
	// the bandwidth controls for the selected bitrates.
	//
	// Not so much cattywampus as Chrome but could be better.
	//
	var sdpLines = sdpStr.split(/\r\n/);
	var sdpSection = 'header';
	var hitMID = false;
	var sdpStrRet = '';
			
	sdpLines = sdpStr.split(/\r\n/);
	
	for(var sdpIndex in sdpLines)
	{
		var sdpLine = sdpLines[sdpIndex];

		if (sdpLine.length <= 0)
			continue;
		
		sdpStrRet += sdpLine;

		if (sdpLine.indexOf("m=audio") === 0)
		{
			sdpSection = 'audio';
			hitMID = false;
		}
		else if (sdpLine.indexOf("m=video") === 0)
		{
			sdpSection = 'video';
			hitMID = false;
		}
		
		if ( sdpLine.indexOf("c=IN") ==0 )
		{
			if ('audio'.localeCompare(sdpSection) == 0)
			{
				sdpStrRet += "\r\nb=TIAS:"+(enhanceData.audioBitrate)+"\r\n";
				sdpStrRet += "b=AS:"+(enhanceData.audioBitrate)+"\r\n";
				sdpStrRet += "b=CT:"+(enhanceData.audioBitrate)+"\r\n";
				continue;
			}
			if ('video'.localeCompare(sdpSection) == 0)
			{
				sdpStrRet += "\r\nb=TIAS:"+(enhanceData.videoBitrate)+"\r\n";
				sdpStrRet += "b=AS:"+(enhanceData.videoBitrate)+"\r\n";
				sdpStrRet += "b=CT:"+(enhanceData.videoBitrate)+"\r\n";
				continue;
			}
		}
		sdpStrRet += '\r\n';
	}
	return sdpStrRet;
}

function errorHandler(error)
{
    console.log(error);
}
