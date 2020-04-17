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
var newAPI = false;
var SDPOutput = new Object();

navigator.getUserMedia = navigator.getUserMedia || navigator.mozGetUserMedia || navigator.webkitGetUserMedia;

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

    var screen_constraints =
    {
		audio: false,
			video: {
			mandatory: {
				chromeMediaSource: 'screen',
				maxWidth: 1920,
				maxHeight: 1080
				},
			optional: []
			}
    };
	
	getScreenId(function (error, sourceId, screen_constraints) {
 
    if(navigator.userAgent.indexOf('Edge') !== -1 && (!!navigator.msSaveOrOpenBlob || !!navigator.msSaveBlob)) {
        navigator.getDisplayMedia(screen_constraints).then(stream => {
            document.querySelector('video').srcObject = stream;
        }, error => {
            alert('Please make sure to use Edge 17 or higher.');
        });
        return;
    }

    navigator.mediaDevices.getUserMedia(screen_constraints).then(getUserMediaSuccess).catch(function (error) {
        console.log(error);
    });
});

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
}

function startPublisher()
{
	wsURL = $('#sdpURL').val();
	streamInfo.applicationName = $('#applicationName').val();
	streamInfo.streamName = $('#streamName').val();

	$.cookie("webrtcPublishWSURL", wsURL, { expires: 365 });
	$.cookie("webrtcPublishApplicationName", streamInfo.applicationName, { expires: 365 });
	$.cookie("webrtcPublishStreamName", streamInfo.streamName, { expires: 365 });

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
	
    peerConnection.setLocalDescription(description, function () {

		wsConnection.send('{"direction":"publish", "command":"sendOffer", "streamInfo":'+JSON.stringify(streamInfo)+', "sdp":'+JSON.stringify(description)+', "userData":'+JSON.stringify(userData)+'}');

    }, function() {console.log('set description error')});
}
function enhanceSDP(sdpStr, enhanceData)
{
	var sdpLines = sdpStr.split(/\r\n/);
	var sdpStrRet = '';

	for(var sdpIndex in sdpLines)
	{
		var sdpLine = sdpLines[sdpIndex];

		if (sdpLine.length <= 0)
			continue;
		
		if ( sdpLine.includes("draft-holmer-rmcat") )
		{
			// Strip out the holmer specficiation we do not support
			continue;
		}

		if ( sdpLine.indexOf("c=IN") ==0  )
		{
			// Set the bitrate of the video to be 500kbps
			sdpStrRet += sdpLine +"\r\n";
			sdpStrRet+="b=AS:500\r\n";
			continue;
		}
		sdpStrRet += sdpLine + "\r\n";
	}
	console.log("Resuling SDP: "+sdpStrRet);
	return sdpStrRet;
}



function errorHandler(error)
{
    console.log(error);
}
