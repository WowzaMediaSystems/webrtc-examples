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
var videoChoice  = "H264";
var audioChoice  = "opus";
var userAgent = null;
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
	
	var cookieVideoChoice = $.cookie("webrtcPublishVideoCodec");
    if (cookieVideoChoice === undefined)
    {
		cookieVideoChoice = videoChoice;
		$.cookie("webrtcPublishVideoCodec", cookieVideoChoice);
	}
	console.log('cookieVideoChoice: '+cookieVideoChoice);

	var cookieAudioChoice = $.cookie("webrtcPublishAudioCodec");
    if (cookieAudioChoice === undefined)
    {
		cookieAudioChoice = audioChoice;
		$.cookie("webrtcPublishAudioCodec", cookieAudioChoice);
	}
	console.log('cookieAudioChoice: '+cookieAudioChoice);


	$('#sdpURL').val(cookieWSURL);
	$('#applicationName').val(cookieApplicationName);
	$('#streamName').val(cookieStreamName);
	$('#videoChoice').val(cookieVideoChoice);
	$('#audioChoice').val(cookieAudioChoice);

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

		if (newAPI)
		{
			var localTracks = localStream.getTracks();
			for(localTrack in localTracks)
			{
				peerConnection.addTrack(localTracks[localTrack], localStream);
			}
		}
		else
		{
			peerConnection.addStream(localStream);
		}

		peerConnection.createOffer(gotDescription, errorHandler);


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

				peerConnection.setRemoteDescription(new RTCSessionDescription(sdpData), function() {
				}, errorHandler);
			}

			var iceCandidates = msgJSON['iceCandidates'];
			if (iceCandidates !== undefined)
			{
				for(var index in iceCandidates)
				{
					console.log('iceCandidates: '+iceCandidates[index]);

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
	videoChoice = $('#videoChoice').val();
	audioChoice = $('#audioChoice').val();

	$.cookie("webrtcPublishWSURL", wsURL, { expires: 365 });
	$.cookie("webrtcPublishApplicationName", streamInfo.applicationName, { expires: 365 });
	$.cookie("webrtcPublishStreamName", streamInfo.streamName, { expires: 365 });
	$.cookie("webrtcPublishAudioCodec", audioChoice , { expires: 365 } );
	$.cookie("webrtcPublishVideoCodec", videoChoice , { expires: 365} );

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
	var enhanceData = new Object();

	description.sdp = enhanceSDP(description.sdp, enhanceData);
	
	// Debug Option left here can be enabled to see the resulting
	// SDP output
	//
	//console.log("SDP is now : "+description.sdp);

    peerConnection.setLocalDescription(description, function () {

	wsConnection.send('{"direction":"publish", "command":"sendOffer", "streamInfo":'+JSON.stringify(streamInfo)+', "sdp":'+JSON.stringify(description)+', "userData":'+JSON.stringify(userData)+'}');

    }, function() {console.log('set description error')});
}

function findCodecIndex(sdpLines,profile)
{
	var index = "" ;
	for(var line in sdpLines)
	{
		var lineInUse = sdpLines[line];
		if ( lineInUse.includes(profile) )
		{
			if ( lineInUse.indexOf("a=rtpmap:") ==0 )
			{
				var pos = lineInUse.split(":")[1];
				pos = pos.split(" ")[0];
				pos = parseInt(pos);
				index +=pos+" ";
			}
		}
	}
	index =index.trim();
	return index;
}

function purgeOtherCodecChoices(sdpLines,videoChoice, audioChoice)
{
	var output = "";
	var vChoices = videoChoice.split(" ");
	var aChoices = audioChoice.split(" ");
	for(var line in sdpLines)
	{
		var lineInUse = sdpLines[line];
				
		if ( lineInUse.indexOf("m=video") == 0 && videoChoice.length !=0 )
		{
			var mLines = lineInUse.split(" ");
			output+=mLines[0]+" "+mLines[1]+" "+mLines[2]+" "+videoIndex+"\r\n";
			continue;
		}

		if ( lineInUse.indexOf("m=audio") ==0 && audioIndex !=-1 )
		{
			var mLines = lineInUse.split(" ");
			output+=mLines[0]+" "+mLines[1]+" "+mLines[2]+" "+audioIndex+"\r\n";
			continue;
		}
		
		if ( lineInUse.indexOf("a=rtpmap:") ==0  ||  lineInUse.indexOf("a=rtcp-fb") ==0 || lineInUse.indexOf("a=rtpmap") ==0 || lineInUse.indexOf("a=fmtp") ==0 )
		{
			for (var vindex in vChoices)
			{
				var pos = lineInUse.split(":")[1];
				pos = pos.split(" ")[0];
				pos = parseInt(pos);
				vindex = vChoices[vindex];
				vindex = parseInt(vindex);				
				if ( pos == vindex )
				{					
					output+=lineInUse+"\r\n";
				}
			}
			for (var aindex in aChoices)
			{
				var pos = lineInUse.split(":")[1];
				pos = pos.split(" ")[0];
				pos = parseInt(pos);
				aindex = aChoices[aindex];
				aindex = parseInt(aindex);
				if ( pos == aindex )
				{
					output+=lineInUse+"\r\n";
				}
			}
			continue;
		}
		output +=lineInUse+"\r\n";
	}
	
	return output;
}

function enhanceSDP(sdpStr, enhanceData)
{
	var sdpLines = sdpStr.split(/\r\n/);
	var sdpSection = 'header';
	var hitMID = false;
	var sdpStrRet = '';
			
	sdpLines = sdpStr.split(/\r\n/);
	
	videoIndex = findCodecIndex(sdpLines,videoChoice);
	audioIndex = findCodecIndex(sdpLines,audioChoice);
	
	sdpStrRet = purgeOtherCodecChoices(sdpLines, videoIndex, audioIndex);

	return sdpStrRet;
}

function errorHandler(error)
{
    console.log(error);
}
