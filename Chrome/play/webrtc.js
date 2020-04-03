const GO_BUTTON_START = "Play";
const GO_BUTTON_STOP = "Stop";

var remoteVideo = null;
var peerConnection = null;
var peerConnectionConfig = {'iceServers': []};
var localStream = null;
var wsURL = "wss://localhost.streamlock.net/webrtc-session.json";
var wsConnection = null;
var streamInfo = {applicationName:"webrtc", streamName:"myStream", sessionId:"[empty]"};
var userData = {param1:"value1"};
var repeaterRetryCount = 0;
var newAPI = false;
var doGetAvailableStreams = false;

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

	$('#sdpURL').val(cookieWSURL);
	$('#applicationName').val(cookieApplicationName);
	$('#streamName').val(cookieStreamName);
	
	$("#buttonGo").attr('value', GO_BUTTON_START);
	
	remoteVideo = document.getElementById('remoteVideo');

	if(navigator.mediaDevices.getUserMedia)
	{
		newAPI = false;
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
		
		if (newAPI)
		{
			peerConnection.ontrack = gotRemoteTrack;
		}
		else
		{
			peerConnection.onaddstream = gotRemoteStream;
		}

		console.log("wsURL: "+wsURL);
		if (doGetAvailableStreams)
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
		console.log("sendPlayGetOffer: "+JSON.stringify(streamInfo));
		wsConnection.send('{"direction":"play", "command":"getOffer", "streamInfo":'+JSON.stringify(streamInfo)+', "userData":'+JSON.stringify(userData)+'}');
	}

	function sendPlayGetAvailableStreams()
	{
		console.log("sendPlayGetAvailableStreams: "+JSON.stringify(streamInfo));
		wsConnection.send('{"direction":"play", "command":"getAvailableStreams", "streamInfo":'+JSON.stringify(streamInfo)+', "userData":'+JSON.stringify(userData)+'}');
	}

	wsConnection.onmessage = function(evt)
	{
		console.log("wsConnection.onmessage: "+evt.data);
		
		var msgJSON = JSON.parse(evt.data);
		
		var msgStatus = Number(msgJSON['status']);
		var msgCommand = msgJSON['command'];
		
		if (msgStatus == 514) // repeater stream not ready
		{
			repeaterRetryCount++;
			if (repeaterRetryCount < 10)
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

			var streamInfoResponse = msgJSON['streamInfo'];
			if (streamInfoResponse !== undefined)
			{
				streamInfo.sessionId = streamInfoResponse.sessionId;
			}

			var sdpData = msgJSON['sdp'];
			if (sdpData !== undefined)
			{
				console.log('sdp: '+JSON.stringify(msgJSON['sdp']));

				// We mundge the SDP here, before creating an Answer
				// If you can get the new MediaAPI to work this might
				// not be needed.
				msgJSON.sdp.sdp = enhanceSDP(msgJSON.sdp.sdp);
				peerConnection.setRemoteDescription(new RTCSessionDescription(msgJSON.sdp), function() {
					peerConnection.createAnswer(gotDescription, errorHandler);
				}, errorHandler);
			}

			var iceCandidates = msgJSON['iceCandidates'];
			if (iceCandidates !== undefined)
			{
				for(var index in iceCandidates)
				{
					console.log('iceCandidates: '+JSON.stringify(iceCandidates[index]));
					peerConnection.addIceCandidate(new RTCIceCandidate(iceCandidates[index]));
				}
			}
		}
		
		if ('sendResponse'.localeCompare(msgCommand) == 0)
		{
			if (wsConnection != null)
				wsConnection.close();
			wsConnection = null;
		}
		// now check for getAvailableResponse command to close the connection 
		if ('getAvailableStreams'.localeCompare(msgCommand) == 0)
		{
			stopPlay();
		}
	}
	
	wsConnection.onclose = function()
	{
		console.log("wsConnection.onclose");
	}
	
	wsConnection.onerror = function(evt)
	{
		console.log("wsConnection.onerror: "+JSON.stringify(evt));
		
		$("#sdpDataTag").html('WebSocket connection failed: '+wsURL);
	}
}

function getAvailableStreams()
{
	doGetAvailableStreams=true;
	startPlay();
}

function startPlay()
{
	repeaterRetryCount = 0;
	
	wsURL = $('#sdpURL').val();
	streamInfo.applicationName = $('#applicationName').val();
	streamInfo.streamName = $('#streamName').val();
		
	$.cookie("webrtcPublishWSURL", wsURL, { expires: 365 });
	$.cookie("webrtcPublishApplicationName", streamInfo.applicationName, { expires: 365 });
	$.cookie("webrtcPublishStreamName", streamInfo.streamName, { expires: 365 });
	
	console.log("startPlay: wsURL:"+wsURL+" streamInfo:"+JSON.stringify(streamInfo));
	
	wsConnect(wsURL);
	
	if (!doGetAvailableStreams)
	{
		$("#buttonGo").attr('value', GO_BUTTON_STOP);
	}
}

function stopPlay()
{
	if (peerConnection != null)
		peerConnection.close();
	peerConnection = null;
	
	if (wsConnection != null)
		wsConnection.close();
	wsConnection = null;
	
	remoteVideo.src = ""; // this seems like a chrome bug - if set to null it will make HTTP request

	console.log("stopPlay");

	$("#buttonGo").attr('value', GO_BUTTON_START);
}

// start button clicked
function start() 
{
	doGetAvailableStreams=false;

	if (peerConnection == null)
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
			peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp), function() {
				peerConnection.createAnswer(gotDescription, errorHandler);
			}, errorHandler);
		}
		else
		{
			console.log('sdp:not-offer: '+signal.sdp.type);
		}

	}
	else if(signal.ice)
	{
		console.log('ice: '+JSON.stringify(signal.ice));
		peerConnection.addIceCandidate(new RTCIceCandidate(signal.ice));
	}
}

function gotIceCandidate(event) 
{
	if(event.candidate != null) 
	{
	}
}

function enhanceSDP(sdpStr)
{
	var sdpLines = sdpStr.split(/\r\n/);
	var sdpSection = 'header';
	var hitMID = false;
	var sdpStrRet = '';

		for(var sdpIndex in sdpLines)
	{
		var sdpLine = sdpLines[sdpIndex];
		
		if ( sdpLine.length == 0 )
			continue;

		if ( sdpLine.includes("profile-level-id") )
		{
			console.log("found profile-id");
			// This profile seems to be correct for the stream publishing,
			// however will not allow Safari to play it back, so we swap
			// it for a baseline constrained one, which is declared when
			// Safari publishes in the SDP.
			if ( sdpLine.includes("640029") )
			{
				sdpLine = sdpLine.replace("640029","42E01F");
			}
		}
		
		sdpStrRet +=sdpLine;
		sdpStrRet += '\r\n';
	}

	console.log("Resuling SDP: "+sdpStrRet);
	return sdpStrRet;
}

function gotDescription(description) 
{
	console.log('gotDescription');
	peerConnection.setLocalDescription(description, function () 
	{
		console.log('sendAnswer');

		wsConnection.send('{"direction":"play", "command":"sendResponse", "streamInfo":'+JSON.stringify(streamInfo)+', "sdp":'+JSON.stringify(description)+', "userData":'+JSON.stringify(userData)+'}');

	}, function() {console.log('set description error')});
}

function gotRemoteTrack(event) 
{
	console.log('gotRemoteTrack: kind:'+event.track.kind+' stream:'+event.streams[0]);
	try{
			remoteVideo.srcObject = event.streams[0];
	} catch (error){
			remoteVideo.src = window.URL.createObjectURL(event.streams[0]);
	}
}

function gotRemoteStream(event) 
{
	console.log('gotRemoteStream: '+event.stream);
	try{
		remoteVideo.srcObject = event.stream;
	} catch (error){
		remoteVideo.src = window.URL.createObjectURL(event.stream);
	}
}

function errorHandler(error) 
{
	console.log(error);
}
