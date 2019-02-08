/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var path = require('path');
var url = require('url');
var express = require('express');
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs    = require('fs');
var https = require('https');

var argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: 'https://localhost:8443/',
    ws_uri: 'ws://localhost:8888/kurento'
  }
});

var options =
  {
    key:  fs.readFileSync('keys/server.key'),
    cert: fs.readFileSync('keys/server.crt')
  };

var app = express();

/*
 * Definition of global variables.
 */
var idCounter = 0;
var candidatesQueue = {};
var kurentoClient = null;
var presenters = [];
var viewers = [];
var noPresenterMessage = 'No active presenter. Try again later...';

/*
 * Server startup
 */
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function() {
  console.log('Kurento Tutorial started');
  console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
  server : server,
  path : '/one2many'
});

function nextUniqueId() {
  idCounter++;
  return idCounter.toString();
}

/*
 * Management of WebSocket messages
 */
wss.on('connection', function(ws) {

  var sessionId = nextUniqueId();
  console.log('Connection received with sessionId ' + sessionId);

  ws.send(JSON.stringify({
    id : 'presenterList',
    presenters : Object.keys(presenters),
  }));
  ws.on('error', function(error) {
    console.log('Connection ' + sessionId + ' error');
    stop(sessionId);
  });

  ws.on('close', function() {
    console.log('Connection ' + sessionId + ' closed');
    stop(sessionId);
  });

  ws.on('message', function(_message) {
    var message = JSON.parse(_message);
    console.log('Connection ' + sessionId + ' received message ', message);

    switch (message.id) {
      case 'presenter':
        startPresenter(sessionId, ws, message.sdpOffer, function(error, sdpAnswer) {
          if (error) {
            return ws.send(JSON.stringify({
              id : 'presenterResponse',
              response : 'rejected',
              message : error
            }));
          }
          ws.send(JSON.stringify({
            id : 'presenterResponse',
            response : 'accepted',
            sdpAnswer : sdpAnswer
          }));
        });
        break;

      case 'viewer':
        startViewer(sessionId, ws, message.sdpOffer, message.presenterId, function(error, sdpAnswer) {
          if (error) {
            return ws.send(JSON.stringify({
              id : 'viewerResponse',
              response : 'rejected',
              message : error
            }));
          }

          ws.send(JSON.stringify({
            id : 'viewerResponse',
            response : 'accepted',
            sdpAnswer : sdpAnswer
          }));
        });
        break;

      case 'stop':
        stop(sessionId);
        break;

      case 'onIceCandidate':
        onIceCandidate(sessionId, message.candidate);
        break;

      default:
        ws.send(JSON.stringify({
          id : 'error',
          message : 'Invalid message ' + message
        }));
        break;
    }
  });
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
  if (kurentoClient !== null) {
    return callback(null, kurentoClient);
  }
//What is this function definition ref doc ?
  kurento(argv.ws_uri, function(error, _kurentoClient) {
    if (error) {
      console.log("Could not find media server at address " + argv.ws_uri);
      return callback("Could not find media server at address" + argv.ws_uri
        + ". Exiting with error " + error);
    }

    kurentoClient = _kurentoClient;
    callback(null, kurentoClient);
  });
}
//Please explain: Is session Id randomly generated? where? Reference docs?
/*
Please search for : nextUniqueId function. line 67-75
And wss.on('connection', function(ws) function. There you can find the id generation
*/
function startPresenter(sessionId, ws, sdpOffer, callback) {
//Please explain: What does the following function do? . Reference docs?
  /*
  This removes all the previose ICE Candidates for that particular viewer/presenter. Please refer the ICE Candidates first.

  */
  clearCandidatesQueue(sessionId);
//Does this check null for the session ID'th element of presenters array ?
//Where is the structure of the presenters[session Id] object defined?.
  /*
  Yes, it is.
  For the struction, please refer around line number 98.
  */
  if (presenters[sessionId]) {
    stop(sessionId);
    return callback("Another user is currently acting as presenter. Try again later ...");
  }
//If not null then set object to these name value pair groups.Here id: is a generated random number?
//what is pipeline? is it {} or a variable? what is webRtcEndpoint ? an object ? contents?
//what is viewers[] ? Does it contain {} s same as presenters[] ?

  /*
  Here we are just initializing the sessionId'th presenter as a good programming practice.
  When the program executes this line, only the sessionId is available. So, at the initialization, we are assign the real value of the session id, and initialize other parameters ot null.
  Both pipeline and WebRTC endpoint are objects. (https://doc-kurento.readthedocs.io/en/6.6.2/mastering/kurento_API.html)
  Since we are going to store all the viewers of this particular presenter inside the presenter object we need an array to store them. Therefor we are initializing an empty array.

  */
  presenters[sessionId] = {
    id : sessionId,
    pipeline : null,
    webRtcEndpoint : null,
    viewers: []
  }
// structure of kurentoClient ? {} ? variables, functions?  reference docs?
// Where is KurentoClient instantiated?
//https://doc-kurento.readthedocs.io/en/6.7.1/_static/client-jsdoc/module-kurentoClient.html
  /*
  getKurentoClient function is defined in line 157. Here, we are only using it.
  The callback of the function returns the Kurento client.

  */
  getKurentoClient(function(error, kurentoClient) {
    if (error) {
      stop(sessionId);
      return callback(error);
    }

    if (presenters[sessionId] === null) {
      stop(sessionId);
      return callback(noPresenterMessage);
    }
//https://doc-kurento.readthedocs.io/en/6.7.1/_static/client-jsdoc/lib_KurentoClient.js.html
//https://doc-kurento.readthedocs.io/en/6.7.1/_static/client-jsdoc/module-kurentoClient.html
//type=MediaPipeline, no params, callback function (error, The created MediaElement=pipeline)
//is pipeline a {} ? what does it contain ?

    /*
    Here is the definition of media pipeline : https://doc-kurento.readthedocs.io/en/6.7.1/_static/client-jsdoc/module-core.MediaPipeline.html
    You can also read a detailed description here : https://doc-kurento.readthedocs.io/en/6.6.2/mastering/kurento_API.html
    */
    kurentoClient.create('MediaPipeline', function(error, pipeline) {
      if (error) {
        stop(sessionId);
        return callback(error);
      }

      if (presenters[sessionId] === null) {
        stop(sessionId);
        return callback(noPresenterMessage);
      }
//is pipeline a {} ? what does it contain ?
      /*
      A pipeline is a container for a collection of MediaElements and :rom:cls:`MediaMixers`. It offers the methods needed to control the creation and connection of elements inside a certain pipeline.
      */
      presenters[sessionId].pipeline = pipeline;
      pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
        if (error) {
          stop(sessionId);
          return callback(error);
        }

        if (presenters[sessionId] === null) {
          stop(sessionId);
          return callback(noPresenterMessage);
        }
// whereis this webRtcEndpoint defined. Is there an id no etc?
        /*
        Here is the definition : https://doc-kurento.readthedocs.io/en/6.7.1/_static/client-jsdoc/module-elements.WebRtcEndpoint.html
        pipeline.create() is a generic function that can be used to create media elements.
        We can retrive the media elements through a callback.
        */
        presenters[sessionId].webRtcEndpoint = webRtcEndpoint;
// definition o candidatesQueue ?
        /*
        An ICE candidate represents a network node. For each participant, we need to gather as much as possible candidates.
        Then we try to establish connections by pairing candidates between two peers.

        here is a good explaination that I found on stack overflow


        Every ICE contains 'a node' of your network,
        until it has reached the outside. By this you send these ICE's to the other peer,
         so they know through what connection points they can reach you. See it as a large building:
          one is in the building, and needs to tell the other (who is not familiar) how to walk through it.
           Same here, if I have a lot of network devices, the incoming connection somehow needs to find the
           right way to my computer. By providing all nodes, the RTC connection finds the shortest route itself.
           So when you would connect to the computer next to you, which is connected to the same router/switch/whatever,
           it uses all ICE's and determine the shortest, and that is directly through that point. That your collegue got
           less ICE candidates has to do with the ammount of devices it has to go through. Please note that every network
           adapter inside your computer which has an IP adress (I have a vEthernet switch from hyper-v) it also creates an ICE for it.

           When peer A has discovered an ICE candidate (a potential route which could be used to communicate),
           it needs to send this ICE candidate to peer B (and vice versa).
           Peer B then adds that ICE candidate to its connection.
           Both peers exchange ICE candidates this way until they
           have found the optimal route that both are able to use to communicate with each other directly.
        */
        if (candidatesQueue[sessionId]) {
          while(candidatesQueue[sessionId].length) {
            var candidate = candidatesQueue[sessionId].shift();
            webRtcEndpoint.addIceCandidate(candidate);
          }
        }
// looks like webRtcEndpoint is a {} what are properties? Ref ?
//What is the logic here?

        /*
        No !!! No !! No!!
        From line 254, we get the webRTCEndpoint object from pipeline.create() function
        */
        webRtcEndpoint.on('OnIceCandidate', function(event) {
          var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
          ws.send(JSON.stringify({
            id : 'iceCandidate',
            candidate : candidate
          }));
        });
//What is the logic here? simply return sdpAnswer or error?
        /*
        Yes, only sending a sdp answer for the sdp offer.

        Read more here : https://doc-kurento.readthedocs.io/en/6.7.1/_static/client-jsdoc/module-elements.WebRtcEndpoint.html

        To Rcap : we do two things in signaling process
        SDP exchaning and ICE candidate gathering
        */
        webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
          if (error) {
            stop(sessionId);
            return callback(error);
          }

          if (presenters[sessionId] === null) {
            stop(sessionId);
            return callback(noPresenterMessage);
          }

          callback(null, sdpAnswer);
        });
//What is the logic here?
        /*
        This is asking the webRTC endpoint to gather ICE candidates

        more here : https://doc-kurento.readthedocs.io/en/6.7.1/_static/client-jsdoc/module-elements.WebRtcEndpoint.html
        Start the gathering of ICE candidates.
        It must be called after SdpEndpoint::generateOffer or SdpEndpoint::processOffer for Trickle ICE. If invoked before generating or processing an SDP offer, the candidates gathered
        */
        webRtcEndpoint.gatherCandidates(function(error) {
          if (error) {
            stop(sessionId);
            return callback(error);
          }
        });
      });
    });
  });
}
//Why do we need session ID and Presenter ID, and Viewer ID ? Why not just session id and 2 properties P and V with boolean vals?
/*
We need to know to which presenter that the viewer wantst to connect.
It's not sufficient knowing whether this is a vier of presenter.
*/
function startViewer(sessionId, ws, sdpOffer, presenterId, callback) {
  clearCandidatesQueue(sessionId);

  if (!presenters[presenterId]) {
    stop(sessionId);
    return callback(noPresenterMessage);
  }
//Is the WebRtcEndpoint  in the callback function the WebRtcEndpoint of the viewer on Source side connected to presenter? WebRtcEndpoint?
  /*
  Yes indeed.
  */
  presenters[presenterId].pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
    if (error) {
      stop(sessionId);
      return callback(error);
    }
    viewers[sessionId] = {
      "webRtcEndpoint" : webRtcEndpoint,
      "ws" : ws
    }


    if (presenters[presenterId] === null) {
      stop(sessionId);
      return callback(noPresenterMessage);
    }
//what is the logic here ?
    /*
    The webRTC Endpoint in the kurento media server should be connected to the webRTC Endpoint of the user.
    Therefor SDP offers/Answers and ICE Candidates should be exchanged between the browser and the respective webRTC endpoint in KMS
    All the ICE candidates sent by the viewer/presenter is stored inside the candidates queue under session ID.
    When we need to connect that presenter/viewer to a webRTC endpoint, we have to sent that V/Ps local ICE candidates to the WebRTC Enpoint of KMS
    that we are going connect the V/P. This is happenning in line 398-402

    On the other hand, we have to send the ICE candidates gatherd by KMS WebRTC Endpoint, to the V/P.
    This is happening in 405-411
    */
    if (candidatesQueue[sessionId]) {
      while(candidatesQueue[sessionId].length) {
        var candidate = candidatesQueue[sessionId].shift();
        webRtcEndpoint.addIceCandidate(candidate);
      }
    }
// What is the logic here ?
    webRtcEndpoint.on('OnIceCandidate', function(event) {
      var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
      ws.send(JSON.stringify({
        id : 'iceCandidate',
        candidate : candidate
      }));
    });

    webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
      if (error) {
        stop(sessionId);
        return callback(error);
      }
      if (presenters[presenterId] === null) {
        stop(sessionId);
        return callback(noPresenterMessage);
      }

      presenters[presenterId].webRtcEndpoint.connect(webRtcEndpoint, function(error) {
        if (error) {
          stop(sessionId);
          return callback(error);
        }
        if (presenters[presenterId] === null) {
          stop(sessionId);
          return callback(noPresenterMessage);
        }

        callback(null, sdpAnswer);
        webRtcEndpoint.gatherCandidates(function(error) {
          if (error) {
            stop(sessionId);
            return callback(error);
          }
        });
      });
    });
  });
}
// What is the logic here ?
/*
When a user reconnects, we have to remove his previouse ICE candidates to allow to gather new candidates
*/
function clearCandidatesQueue(sessionId) {
  if (candidatesQueue[sessionId]) {
    delete candidatesQueue[sessionId];
  }
}

function stop(sessionId) {
  if (presenters[sessionId] && presenters[sessionId].id == sessionId) {
    for (var i in presenters[sessionId].viewers) {
      var viewer = presenters[sessionId].viewers[i];
      if (viewer.ws) {
        viewer.ws.send(JSON.stringify({
          id : 'stopCommunication'
        }));
      }
    }
    presenters[sessionId].pipeline.release();
    presenters[sessionId].viewers = [];
    presenters[sessionId] = null;

  } else if (viewers[sessionId]) {
    viewers[sessionId].webRtcEndpoint.release();
    delete viewers[sessionId];
  }

  clearCandidatesQueue(sessionId);

  if (viewers.length < 1 && !presenters[sessionId] && kurentoClient !== null) {
    console.log('Closing kurento client');
    kurentoClient.close();
    kurentoClient = null;
  }
}
// What is teh logic  here?

/*
When we receive an ICE candidate from V/P, we have to store it in Candidates queue for future use.
*/
function onIceCandidate(sessionId, _candidate) {
  var candidate = kurento.getComplexType('IceCandidate')(_candidate);

  if (presenters[sessionId] && presenters[sessionId].id === sessionId && presenters[sessionId].webRtcEndpoint) {
    console.info('Sending presenter candidate');
    presenters[sessionId].webRtcEndpoint.addIceCandidate(candidate);
  }
  else if (viewers[sessionId] && viewers[sessionId].webRtcEndpoint) {
    console.info('Sending viewer candidate');
    viewers[sessionId].webRtcEndpoint.addIceCandidate(candidate);
  }
  else {
    console.info('Queueing candidate');
    if (!candidatesQueue[sessionId]) {
      candidatesQueue[sessionId] = [];
    }
    candidatesQueue[sessionId].push(candidate);
  }
}

app.use(express.static(path.join(__dirname, 'static')));
