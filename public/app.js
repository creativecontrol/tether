/**
  TODO:
  - Add aux input capability https://blog.mozilla.org/webrtc/channelcount-microphone-constraint/
  with stereo audio (channelCount), no AGC (autoGainControl),noise suppression (noiseSuppression) and AEC (echoCancellation)
  - Settings should also allow for separate outputs for mic and audio streams (if possible)

  - Move MIDI handling to a new class/file for simplicity
*/
class Tether {
  constructor() {
    mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

    this.configuration = {
      iceServers: [
        {
          urls: [
            'stun:stun1.l.google.com:19302',
            'stun:stun2.l.google.com:19302',
          ],
        },
      ],
      iceCandidatePoolSize: 10,
    };

    this.db = null;
    this.roomRef = null;

    this.peerConnection = null;
    this.localVideo = document.querySelector('#localVideo');
    this.localStream = null;
    this.remoteStream = null;
    this.localDataChannel = null;
    this.dataChannelIsOpen = false;
    this.receiveDataChannel = null;
    this.roomDialog = null;
    this.roomId = null;

    this.settingsDialog = null;
    this.settingsAction = document.getElementById("settingsButton");
    this.auxInputSelect = document.querySelector('select#auxSource');
    this.micInputSelect = document.querySelector('select#micSource');
    this.audioOutputSelect = document.querySelector('select#audioOutput');
    this.videoSelect = document.querySelector('select#videoSource');
    this.selectors = [this.auxInputSelect, this.audioOutputSelect, this.micInputSelect, this.videoSelect];

    this.activateMidiAction = document.getElementById("activateMidi");
    this.midiInitButton = document.getElementById("midiInactive");
    this.midiUI = document.getElementById("midiActive");
    this.midiRefresh = document.getElementById("midiRefresh");
    this.midiInputMenu = document.getElementById("midiInSelect");
    this.midiOutputMenu = document.getElementById("midiOutSelect");
    this.currentMIDIInput = null;
    this.curretMIDIOutput = null;

    this.notify = document.getElementById("notifications");

    this.micMuteToggle = new mdc.iconButton.MDCIconButtonToggle(document.getElementById("microphone"));
    this.videoMuteToggle = new mdc.iconButton.MDCIconButtonToggle(document.getElementById("videoFeed"));
    this.audioMuteToggle = new mdc.iconButton.MDCIconButtonToggle(document.getElementById("audioIn"));

    this.init();

  }

  init() {
    let that = this;

    firebase.auth().signInAnonymously()
      .then(() => {
        that.db = firebase.firestore();
      })
      .catch((error) => {
        var errorCode = error.code;
        var errorMessage = error.message;
        // ...
      });


    navigator.mediaDevices.enumerateDevices().then((deviceInfo) => {this.gotDevices(deviceInfo)}).catch((e) => {that.handleGetMediaError(e)});
    document.querySelector('#cameraBtn').onclick = ()=>{this.openUserMedia();};
    document.querySelector('#hangupBtn').onclick = ()=>{this.hangUp();};
    document.querySelector('#createBtn').onclick = ()=>{this.createRoom();};
    document.querySelector('#joinBtn').onclick = ()=>{this.joinRoom();};
    document.querySelector('#copyID').onclick = ()=>{this.copyID()};
    // document.querySelector('#sendMsg').onclick = ()=>{this.sendAMessage();};
    this.roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));

    this.settingsDialog = new mdc.dialog.MDCDialog(document.querySelector('#settingsDialog'));
    this.settingsAction.onclick = () => {
      this.settingsDialog.open();

    }

    this.micInputSelect.onchange = () => {this.startMedia()};
    this.auxInputSelect.onchange = () => {this.startMedia()};
    this.audioOutputSelect.onchange = () => {this.changeAudioDestination()};
    this.videoSelect.onchange = () => {this.startMedia()};

    this.micMuteToggle.listen('click', () => {
      this.micControlAction(this.micMuteToggle.on);
    });

    this.videoMuteToggle.listen('click', () => {
      this.videoControlAction(this.videoMuteToggle.on);
    });

    this.activateMidiAction.onclick = () => {
      that.hideMIDIInit();
      that.showMIDISelect();
      // Tone.context.resume();
      that.initMidi();
    }

    this.midiRefresh.onclick = () => {
      this.refreshMIDIDevices();
    }

    this.midiInputMenu.onchange = () => {
        console.log('changing MIDI input');
        if (that.currentMIDIInput) {
          that.currentMIDIInput.removeListener();
        }
        try {
          if(that.midiInputMenu.value != null) {
            that.currentMIDIInput = WebMidi.getInputById(that.midiInputMenu.value);
            console.log(that.currentMIDIInput);

            if(that.currentMIDIInput) {
              that.currentMIDIInput.addListener('midimessage', 'all', (midiEvent) => {
                console.log("MIDI message");
                // console.log(midiEvent);
                that.sendMIDIMessage(midiEvent);
              })
            }
          }
        } catch (error) {
          console.error(error);
        }
    };

    this.midiOutputMenu.onchange = ()=> {
      that.currentMIDIOutput = WebMidi.getOutputById(that.midiOutputMenu.value);
      console.log(that.currentMIDIOutput);
    };
  }

  micControlAction(status) {
    this.localStream.getAudioTracks()[0].enabled = status;
  }

  videoControlAction(status) {
    this.localStream.getVideoTracks()[0].enabled = status;
  }

  async createRoom() {
    let that = this;

    document.querySelector('#createBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = true;

    this.roomRef = await this.db.collection('rooms').doc(this.generateId());

    console.log('Create PeerConnection with configuration: ', that.configuration);
    this.peerConnection = new RTCPeerConnection(that.configuration);

    this.registerPeerConnectionListeners();

    this.localStream.getTracks().forEach(track => {
      that.peerConnection.addTrack(track, that.localStream);
    });

    // Add dataChannel for MIDI sending

    this.localDataChannel = this.peerConnection.createDataChannel('midi');

    this.localDataChannel.onopen = event => {
      that.dataChannelIsOpen = true;
    };
    this.localDataChannel.onclose = event => {
      that.dataChannelIsOpen = true;
    };
    this.localDataChannel.onmessage = event => {
      that.handleMIDIMessage(event.data);
    };



    // Code for collecting ICE candidates below
    this.callerCandidatesCollection = this.roomRef.collection('callerCandidates');

    this.peerConnection.addEventListener('icecandidate', event => {
      if (!event.candidate) {
        console.log('Got final candidate!');
        return;
      }
      console.log('Got candidate: ', event.candidate);
      this.callerCandidatesCollection.add(event.candidate.toJSON());
    });
    // Code for collecting ICE candidates above

    // Code for creating a room below
    this.offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(this.offer);
    console.log('Created offer:', this.offer);

    this.roomWithOffer = {
      'offer': {
        type: that.offer.type,
        sdp: that.offer.sdp,
      },
    };
    await this.roomRef.set(this.roomWithOffer);
    this.roomId = this.roomRef.id;
    console.log(`New room created with SDP offer. Room ID: ${this.roomRef.id}`);
    document.querySelector(
        '#currentRoom').innerText = `Current room is ${this.roomRef.id} - You are the caller!`;
    document.querySelector('#copyID').style.visibility = "visible";
    document.querySelector('#currentRoom').style.visibility = "visible";
    this.showMIDIInit();
    // Code for creating a room above

    this.peerConnection.addEventListener('track', event => {
      console.log('Got remote track:', event.streams[0]);
      event.streams[0].getTracks().forEach(track => {
        console.log('Add a track to the remoteStream:', track);
        that.remoteStream.addTrack(track);
      });
    });

    // Listening for remote session description below
    this.roomRef.onSnapshot(async snapshot => {
      that.data = snapshot.data();
      if (!that.peerConnection.currentRemoteDescription && that.data && that.data.answer) {
        console.log('Got remote description: ', that.data.answer);
        that.rtcSessionDescription = new RTCSessionDescription(that.data.answer);
        await that.peerConnection.setRemoteDescription(that.rtcSessionDescription);
      }
    });
    // Listening for remote session description above

    // Listen for remote ICE candidates below
    this.roomRef.collection('calleeCandidates').onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          let data = change.doc.data();
          console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
          await that.peerConnection.addIceCandidate(new RTCIceCandidate(data));
        }
      });
    });
    // Listen for remote ICE candidates above
  }

  generateId() {
    let length = 6;
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }

  /**
  */
  copyID() {
    navigator.clipboard.writeText(this.roomRef.id);
    console.log('copied room ID');

    this.notify.innerHTML = 'copied room ID !';
    this.notify.style.visibility = "visible";

    setTimeout(()=>{
      this.notify.innerHTML = '';
      this.notify.style.visibility = "hidden";
    }, 2000);
  }

  /**
  */
  joinRoom() {
    let that = this;
    document.querySelector('#createBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = true;

    document.querySelector('#confirmJoinBtn').
        addEventListener('click', async () => {
          that.roomId = document.querySelector('#room-id').value;
          console.log('Join room: ', that.roomId);
          document.querySelector(
              '#currentRoom').innerText = `Current room is ${that.roomId} - You are the callee!`;
          document.querySelector('#currentRoom').style.visibility = "visible";
          that.showMIDIInit();
          await that.joinRoomById(that.roomId);
        }, {once: true});
    this.roomDialog.open();
  }

  /**
  */
  async joinRoomById(roomId) {
    let that = this;

    this.db = firebase.firestore();
    this.roomRef = this.db.collection('rooms').doc(`${roomId}`);
    this.roomSnapshot = await this.roomRef.get();
    console.log('Got room:', this.roomSnapshot.exists);

    if (this.roomSnapshot.exists) {
      console.log('Create PeerConnection with configuration: ', that.configuration);
      that.peerConnection = new RTCPeerConnection(that.configuration);
      that.registerPeerConnectionListeners();
      that.localStream.getTracks().forEach(track => {
        that.peerConnection.addTrack(track, that.localStream);
      });

      // Code for collecting ICE candidates below
      this.calleeCandidatesCollection = this.roomRef.collection('calleeCandidates');
      this.peerConnection.addEventListener('icecandidate', event => {
        if (!event.candidate) {
          console.log('Got final candidate!');
          return;
        }
        console.log('Got candidate: ', event.candidate);
        that.calleeCandidatesCollection.add(event.candidate.toJSON());
      });
      // Code for collecting ICE candidates above

      this.peerConnection.addEventListener('track', event => {
        console.log('Got remote track:', event.streams[0]);
        event.streams[0].getTracks().forEach(track => {
          console.log('Add a track to the remoteStream:', track);
          that.remoteStream.addTrack(track);
        });
        that.showRemoteVideo();
      });

      // Handle MIDI over the DataChannel
      this.peerConnection.ondatachannel = event => {
        console.log("caller send channel: ", event.channel);
        that.localDataChannel = event.channel;
        that.localDataChannel.onmessage = event => {that.handleMIDIMessage(event.data);};
        that.localDataChannel.onopen = () => {that.dataChannelIsOpen = true;};
        that.localDataChannel.onclose = () => {that.dataChannelIsOpen = false;};
      }

      // Code for creating SDP answer below
      this.offer = this.roomSnapshot.data().offer;
      console.log('Got offer:', this.offer);
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(this.offer));
      this.answer = await this.peerConnection.createAnswer();
      console.log('Created answer:', this.answer);
      await this.peerConnection.setLocalDescription(this.answer);

      this.roomWithAnswer = {
        answer: {
          type: that.answer.type,
          sdp: that.answer.sdp,
        },
      };
      await this.roomRef.update(this.roomWithAnswer);
      // Code for creating SDP answer above

      // Listening for remote ICE candidates below
      this.roomRef.collection('callerCandidates').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(async change => {
          if (change.type === 'added') {
            let data = change.doc.data();
            console.log(`Got new remote ICE candidate: ${JSON.stringify(data)}`);
            await that.peerConnection.addIceCandidate(new RTCIceCandidate(data));
          }
        });
      });
      // Listening for remote ICE candidates above
    }
  }

  /**
  */
  openUserMedia(e) {
    let that = this;

    this.startMedia();
    // this.localVideo.srcObject = this.stream;
    // this.localStream = this.stream;
    this.showLocalVideo();
    this.showCallControls();
    this.remoteStream = new MediaStream();
    document.querySelector('#remoteVideo').srcObject = this.remoteStream;

    document.querySelector('#cameraBtn').disabled = true;
    document.querySelector('#joinBtn').disabled = false;
    document.querySelector('#createBtn').disabled = false;
    document.querySelector('#hangupBtn').disabled = false;
  }

  /**
    Based on the selections of the user, update and reattach the media elements as needed.
    This might happen before or during the call.
  */
  async startMedia() {
    let that = this;

    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        track.stop();
      });
    }
    let auxSource = this.auxInputSelect.value;
    let micSource = this.micInputSelect.value;
    let videoSource = this.videoSelect.value;
    let constraints = {
      audio: {deviceId: micSource ? {exact: micSource} : undefined},
      video: {deviceId: videoSource ? {exact: videoSource} : undefined}
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints)
      .then((stream) => {
        return that.gotStream(stream);
      })
      .then((deviceInfo) => {
        console.log('chain device info:', deviceInfo);
        return that.gotDevices(deviceInfo);
      })
      .catch((e) => {
        that.handleGetMediaError(e);
      });
  }

  showLocalVideo() {
    document.querySelector('#localVideo').style.visibility = "visible";
  }
  hideLocalVideo() {
    document.querySelector('#localVideo').style.visibility = "hidden";
  }

  showRemoteVideo() {
    document.querySelector('#remoteVideo').style.visibility = "visible";
  }
  hideRemoteVideo() {
    document.querySelector('#remoteVideo').style.visibility = "hidden";
  }

  showCallControls() {
    document.querySelector('#controls').style.visibility = "visible";
  }
  hideCallControls() {
    document.querySelector('#controls').style.visibility = "hidden";
  }

  showMIDIInit() {
    this.midiInitButton.style.display = "block";
    this.midiInitButton.style.visibility = "visible";
  }
  hideMIDIInit() {
    this.midiInitButton.style.display = "none";
  }

  showMIDISelect() {
    this.midiUI.style.display = "block";
  }
  hideMIDISelect() {
    this.midiUI.style.display = "none";
  }

  showLoader() {
    document.querySelector('.loader').style.visibility = "visible";

  }

  /**
  */
  async hangUp(e) {
    let that = this;

    this.tracks = document.querySelector('#localVideo').srcObject.getTracks();
    this.tracks.forEach(track => {
      track.stop();
    });

    this.hideCallControls();
    this.hideLocalVideo();
    this.hideRemoteVideo();

    if (that.remoteStream) {
      that.remoteStream.getTracks().forEach(track => track.stop());
    }

    if (that.peerConnection) {
      that.peerConnection.close();
    }

    document.querySelector('#localVideo').srcObject = null;
    document.querySelector('#remoteVideo').srcObject = null;
    document.querySelector('#cameraBtn').disabled = false;
    document.querySelector('#joinBtn').disabled = true;
    document.querySelector('#createBtn').disabled = true;
    document.querySelector('#hangupBtn').disabled = true;
    document.querySelector('#currentRoom').innerText = '';
    document.querySelector('#copyID').style.visibility = 'hidden';

    this.hideMIDIInit();
    this.hideMIDISelect();

    this.showLoader();

    // Delete room on hangup
    if (that.roomId) {
      //that.db = firebase.firestore();
      that.roomRef = that.db.collection('rooms').doc(that.roomId);
      that.calleeCandidates = await that.roomRef.collection('calleeCandidates').get();
      that.calleeCandidates.forEach(async candidate => {
        await candidate.ref.delete();
      });
      that.callerCandidates = await that.roomRef.collection('callerCandidates').get();
      that.callerCandidates.forEach(async candidate => {
        await candidate.ref.delete();
      });
      await that.roomRef.delete();
    }

    setTimeout(() => document.location.reload(true), 1000);
  }

  /**
  */
  registerPeerConnectionListeners() {
    let that = this;

    this.peerConnection.addEventListener('icegatheringstatechange', () => {
      console.log(
          `ICE gathering state changed: ${that.peerConnection.iceGatheringState}`);
    });

    this.peerConnection.addEventListener('connectionstatechange', () => {
      console.log(`Connection state change: ${that.peerConnection.connectionState}`);
    });

    this.peerConnection.addEventListener('signalingstatechange', () => {
      console.log(`Signaling state change: ${that.peerConnection.signalingState}`);
    });

    this.peerConnection.addEventListener('iceconnectionstatechange ', () => {
      console.log(
          `ICE connection state change: ${that.peerConnection.iceConnectionState}`);
    });
  }

  gotStream(stream) {
    this.stream = stream; // make stream available to console
    this.localVideo.srcObject = this.stream;
    this.localStream = this.stream;
    // Refresh button list in case labels have become available

    return navigator.mediaDevices.enumerateDevices();
  }

  gotDevices(deviceInfos) {
    console.log('devices: ', deviceInfos);
    let that = this;
    // Handles being called several times to update labels. Preserve values.
    console.log(this.selectors);
    let values = this.selectors.map(select => select.value);
    this.selectors.forEach(select => {
      while (select.firstChild) {
        select.removeChild(select.firstChild);
      }
    });
    for (let i = 0; i !== deviceInfos.length; ++i) {
      const deviceInfo = deviceInfos[i];
      const option = document.createElement('option');
      option.value = deviceInfo.deviceId;
      if (deviceInfo.kind === 'audioinput') {
        option.text = deviceInfo.label || `audio input ${that.audioInputSelect.length + 1}`;
        that.micInputSelect.appendChild(option);
        let option2 = document.createElement('option');
        option2.value = deviceInfo.deviceId;
        option2.text = deviceInfo.label || `audio input ${that.audioInputSelect.length + 1}`;
        that.auxInputSelect.appendChild(option2);
      } else if (deviceInfo.kind === 'audiooutput') {
        option.text = deviceInfo.label || `speaker ${that.audioOutputSelect.length + 1}`;
        that.audioOutputSelect.appendChild(option);
      } else if (deviceInfo.kind === 'videoinput') {
        option.text = deviceInfo.label || `camera ${that.videoSelect.length + 1}`;
        that.videoSelect.appendChild(option);
      } else {
        console.log('Some other kind of source/device: ', deviceInfo);
      }
    }
    this.selectors.forEach((select, selectorIndex) => {
      if (Array.prototype.slice.call(select.childNodes).some(n => n.value === values[selectorIndex])) {
        select.value = values[selectorIndex];
      }
    });
  }

  handleGetMediaError(error) {
    console.log('navigator.MediaDevices.getUserMedia error: ', error.message, error.name);
  }

  attachSinkId(element, sinkId) {
    if (typeof element.sinkId !== 'undefined') {
      element.setSinkId(sinkId)
          .then(() => {
            console.log(`Success, audio output device attached: ${sinkId}`);
          })
          .catch(error => {
            let errorMessage = error;
            if (error.name === 'SecurityError') {
              errorMessage = `You need to use HTTPS for selecting audio output device: ${error}`;
            }
            console.error(errorMessage);
            // Jump back to first output device in the list as it's the default.
            this.audioOutputSelect.selectedIndex = 0;
          });
    } else {
      console.warn('Browser does not support output device selection.');
    }
  }

  changeAudioDestination() {
    const audioDestination = this.audioOutputSelect.value;
    attachSinkId(that.localVideo, audioDestination);
  }

  initMidi () {
    let that = this;

    WebMidi.enable(function (err) {
      if (err) {
        console.log("WebMidi could not be enabled.", err);
        return;
      } else {
        console.log("WebMidi enabled!");
      }

      // Reacting when a new device becomes available
      // Will need to update to check if input already exists
      WebMidi.addListener("connected", function(e) {
        // that.fillInputs();
        // that.fillOutputs();
      });

      // Reacting when a device becomes unavailable
      WebMidi.addListener("disconnected", function(e) {
        // that.fillInputs();
        // that.fillOutputs();
      });

      that.fillMIDIInputs();
      that.fillMIDIOutputs();
    });

  }

  fillMIDIInputs() {
    let that = this;

    //TODO: Add buffer entry so it has to be selected
    this.midiInputMenu.innerHTML = "";
    this.midiInputMenu.appendChild(this.makeNullOption());

    WebMidi.inputs.forEach(input => {
      let option = document.createElement("option");
      option.value = input.id;
      option.textContent = 'MIDI: ' + input.name;
      that.midiInputMenu.appendChild(option);
    });

    // if (that.currentInput) {
    //   that.inputMenu.value = that.currentInput;
    // }
  }

  fillMIDIOutputs() {
    let that = this;
    this.midiOutputMenu.innerHTML = "";
    this.midiOutputMenu.appendChild(this.makeNullOption());

    WebMidi.outputs.forEach(output => {
      let option = document.createElement("option");
      option.value = output.id;
      option.textContent = 'MIDI: ' + output.name;
      that.midiOutputMenu.appendChild(option);
    });

    // if (that.currentOutput) {
    //   that.outputMenu.value = that.currentOutput;
    // }
  }

  makeNullOption() {
    let option = document.createElement("option");
    option.value = null;
    option.textContent = '--Select one--';
    return option;
  }

  refreshMIDIDevices() {
    this.fillMIDIInputs();
    // Select the one currently selected
    this.fillMIDIOutputs();
  }

  handleMIDIMessage(midiMessage) {
    let that = this;
    let message = JSON.parse(midiMessage);
    console.log(message);
    if (this.currentMIDIOutput) {

      let command = message.data[0];
      let note = message.data[1];
      let channel = command;
      let velocity = (message.data[2] !== undefined) ? message.data[2] : 0;

      let noteOn = 144;
      let noteOff = 128;
      let noteRange = 16;

      if (command >= noteOn && command < noteOn+noteRange) {
        console.log('sending note on');
        let channel = command - noteOn + 1;
        if (velocity > 0) {
            that.currentMIDIOutput.playNote(note, channel, {velocity: velocity});
        } else {
            that.currentMIDIOutput.stopNote(note, channel);
        }
      } else if(command >= noteOff && command < noteOff+noteRange) {
          let channel = command - noteOff;
          that.currentMIDIOutput.stopNote(note, channel);
      }
    }
  }

  sendMIDIMessage(message) {
    if(this.dataChannelIsOpen) {
      this.localDataChannel.send(JSON.stringify(message));
    }
  }

  sendAMessage() {
    this.localDataChannel.send("Hello");
  }

} // End of Tether Class

window.onload = ()=> {
  window.app = new Tether();
}
