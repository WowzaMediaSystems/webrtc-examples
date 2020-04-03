const PLAY_BUTTON_START = "Show Remote";
const PLAY_BUTTON_STOP = "Stop Remote";
var peerConnectionPlay = null;
var peerConnectionConfigPlay = {'iceServers': []};
var remoteVideoPlay = null;
var localStreamPlay = null;
var streamInfoPlay = {applicationName:"webrtc", streamName:"myStream", sessionId:"[empty]"};
var wsConnectionPlay = null;
var userDataPlay = {param1:"value1"};
var repeaterRetryCountPlay = 0;
var newAPIPlay = false;
var doGetAvailableStreamsPlay = false;

window.RTCPeerConnection2 = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
window.RTCIceCandidate2 = window.RTCIceCandidate || window.mozRTCIceCandidate || window.webkitRTCIceCandidate;
window.RTCSessionDescription2 = window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription;

function pageReadyPlay(streamName)
{
//	var cookieStreamName = $.cookie("webrtcPlayStreamName");
//	if (cookieStreamName === undefined)
//	{
//
//		cookieStreamName = streamName;
//		$.cookie("webrtcPlayStreamName", cookieStreamName);
//	}

	var cookieStreamName = streamName;
	$.cookie("webrtcPlayWSURL", "wss://[YOUR CERT NAME HERE]/webrtc-session.json");
	$.cookie("webrtcPlayApplicationName", "webrtc");
	$.cookie("webrtcPlayStreamName", streamName);

	console.log('cookieStreamName: '+$.cookie("webrtcPlayStreamName"));
	console.log('webrtcPlayApplicationName: '+$.cookie("webrtcPlayApplicationName"));
	console.log('cookieWSURL: '+$.cookie("webrtcPlayWSURL"));


//	$('#sdpURL').val($.cookie("webrtcPlayWSURL"));
//	$('#applicationName').val($.cookie("webrtcPlayApplicationName"));
//	$('#streamName').val($.cookie("webrtcPlayStreamName"));

	$("#buttonGo2").attr('value', PLAY_BUTTON_START);

	remoteVideoPlay = document.getElementById('remoteVideo');

	if(navigator.mediaDevices.getUserMedia)
	{
		newAPIPlay = false;
	}

	console.log("newAPIPlay: "+newAPIPlay);
}

function wsConnectPlay(url)
{
	wsConnectionPlay = new WebSocket(url);
	wsConnectionPlay.binaryType = 'arraybuffer';

	wsConnectionPlay.onopen = function()
	{
		console.log("wsConnectionPlay.onopen");

		peerConnectionPlay = new RTCPeerConnection2(peerConnectionConfigPlay);
		peerConnectionPlay.onicecandidate = gotIceCandidatePlay;

		if (newAPIPlay)
		{
			peerConnectionPlay.ontrack = gotRemoteTrack;
		}
		else
		{
			peerConnectionPlay.onaddstream = gotRemoteStream;
		}

		console.log("wsURL: "+wsURL);
		if (doGetAvailableStreamsPlay)
		{
			sendPlayGetAvailableStreams();
		}
		else
		{
			sendPlayGetOffer();
		}
	}

	function sendPlayGetOffer()
	{
		console.log("sendPlayGetOffer: "+JSON.stringify(streamInfoPlay));
		wsConnectionPlay.send('{"direction":"play", "command":"getOffer", "streamInfo":'+JSON.stringify(streamInfoPlay)+', "userData":'+JSON.stringify(userDataPlay)+'}');
	}

	function sendPlayGetAvailableStreams()
	{
		console.log("sendPlayGetAvailableStreams: "+JSON.stringify(streamInfoPlay));
		wsConnectionPlay.send('{"direction":"play", "command":"getAvailableStreams", "streamInfo":'+JSON.stringify(streamInfoPlay)+', "userData":'+JSON.stringify(userDataPlay)+'}');
	}

	wsConnectionPlay.onmessage = function(evt)
	{
		console.log("wsConnectionPlay.onmessage: "+evt.data);

		var msgJSON = JSON.parse(evt.data);

		var msgStatus = Number(msgJSON['status']);
		var msgCommand = msgJSON['command'];

		console.log("=====> msgStatus = "+msgStatus);
		if (msgStatus == 514) // repeater stream not ready
		{
			repeaterRetryCountPlay++;
			if (repeaterRetryCountPlay < 10)
			{
				setTimeout(sendGetOffer, 500);
			}
			else
			{
				$("#sdpDataTag").html('Live stream repeater timeout: '+streamName);
				stopPlay();
			}
		}
		else if (msgStatus != 200)
		{
			$("#sdpDataTag").html(msgJSON['statusDescription']);
			stopPlay();
		}
		else
		{
			$("#sdpDataTag").html("");

			var streamInfoPlayResponse = msgJSON['streamInfo'];
			if (streamInfoPlayResponse !== undefined)
			{
				streamInfoPlay.sessionId = streamInfoPlayResponse.sessionId;
			}

			var sdpData = msgJSON['sdp'];
			if (sdpData !== undefined)
			{
				console.log('sdp: '+JSON.stringify(msgJSON['sdp']));

				peerConnectionPlay.setRemoteDescription(new RTCSessionDescription2(msgJSON.sdp), function() {
					peerConnectionPlay.createAnswer(gotDescriptionPlay, errorHandlerPlay);
				}, errorHandlerPlay);
			}

			var iceCandidates = msgJSON['iceCandidates'];
			if (iceCandidates !== undefined)
			{
				for(var index in iceCandidates)
				{
					console.log('iceCandidates: '+JSON.stringify(iceCandidates[index]));
					peerConnectionPlay.addIceCandidate(new RTCIceCandidate2(iceCandidates[index]));
				}
			}
		}

		if ('sendResponse'.localeCompare(msgCommand) == 0)
		{
			if (wsConnectionPlay != null)
				wsConnectionPlay.close();
			wsConnectionPlay = null;
		}
		// now check for getAvailableResponse command to close the connection
		if ('getAvailableStreams'.localeCompare(msgCommand) == 0)
		{
			stopPlay();
		}
	}

	wsConnectionPlay.onclose = function()
	{
		console.log("wsConnectionPlay.onclose");
	}

	wsConnectionPlay.onerror = function(evt)
	{
		console.log("wsConnectionPlay.onerror: "+JSON.stringify(evt));

		$("#sdpDataTag").html('WebSocket connection failed: '+wsURL);
	}
}

function getAvailableStreams()
{
	doGetAvailableStreamsPlay=true;
	startPlay();
}

function startPlay()
{
	repeaterRetryCountPlay = 0;

//	$('#sdpURL').val($.cookie("webrtcPlayWSURL"));
//	$('#applicationName').val($.cookie("webrtcPlayApplicationName"));
//	$('#streamName').val($.cookie("webrtcPlayStreamName"));

	wsURL = $.cookie("webrtcPlayWSURL");
	streamInfoPlay.applicationName = $.cookie("webrtcPlayApplicationName");
	streamInfoPlay.streamName = $.cookie("webrtcPlayStreamName"); ////$('#streamName').val();
	console.log(streamInfoPlay);
//	$.cookie("webrtcPlayWSURL", wsURL, { expires: 365 });
//	$.cookie("webrtcPlayApplicationName", streamInfoPlay.applicationName, { expires: 365 });
//	$.cookie("webrtcPlayStreamName", streamInfoPlay.streamName, { expires: 365 });

	console.log("startPlay: wsURL:"+wsURL+" streamInfoPlay:"+JSON.stringify(streamInfoPlay));

	wsConnectPlay(wsURL);

	if (!doGetAvailableStreamsPlay)
	{
		$("#buttonGo2").attr('value', PLAY_BUTTON_STOP);
			console.log("Sorry, no streams available.");
	}
}

function stopPlay()
{
	if (peerConnectionPlay != null)
		peerConnectionPlay.close();
	peerConnectionPlay = null;

	if (wsConnectionPlay != null)
		wsConnectionPlay.close();
	wsConnectionPlay = null;

	if (remoteVideoPlay != null)
		remoteVideoPlay.src = ""; // this seems like a chrome bug - if set to null it will make HTTP request

	$("#buttonGo2").attr('value', PLAY_BUTTON_START);
	console.log("stopPlay");
}

// start button clicked
function start2()
{
	doGetAvailableStreamsPlay=false;

	if (peerConnectionPlay == null)
		startPlay();
	else
		stopPlay();
}

function gotMessageFromServer(message)
{
	var signal = JSON.parse(message.data);
	if(signal.sdp)
	{
		if (signal.sdp.type == 'offer')
		{
			console.log('sdp:offser');
			console.log(signal.sdp.sdp);
			peerConnectionPlay.setRemoteDescription(new RTCSessionDescription2(signal.sdp), function() {
				peerConnectionPlay.createAnswer(gotDescriptionPlay, errorHandlerPlay);
			}, errorHandlerPlay);
		}
		else
		{
			console.log('sdp:not-offer: '+signal.sdp.type);
		}

	}
	else if(signal.ice)
	{
		console.log('ice: '+JSON.stringify(signal.ice));
		peerConnectionPlay.addIceCandidate(new RTCIceCandidate2(signal.ice));
	}
}

function gotIceCandidatePlay(event)
{
	if(event.candidate != null)
	{
	}
}

function gotDescriptionPlay(description)
{
	console.log('gotDescriptionPlay');
	peerConnectionPlay.setLocalDescription(description, function ()
	{
		console.log('sendAnswer');

		wsConnectionPlay.send('{"direction":"play", "command":"sendResponse", "streamInfo":'+JSON.stringify(streamInfoPlay)+', "sdp":'+JSON.stringify(description)+', "userData":'+JSON.stringify(userDataPlay)+'}');

	}, function() {console.log('set description error')});
}

function gotRemoteTrack(event)
{
	console.log('gotRemoteTrack: kind:'+event.track.kind+' stream:'+event.streams[0]);

	try{
			remoteVideoPlay.srcObject = event.streams[0];
	} catch (error){
			remoteVideoPlay.src = window.URL.createObjectURL(event.streams[0]);
	}
}

function gotRemoteStream(event)
{
	console.log('gotRemoteStream: '+event.stream);
	console.log(event.stream);
	try{
		remoteVideoPlay.srcObject = event.stream;
	} catch (error){
		remoteVideoPlay.src = window.URL.createObjectURL(event.stream);
	}
}

function errorHandlerPlay(error)
{
	console.log(error);
}
