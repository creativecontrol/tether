/**
  TODO:
  - Add aux input capability https://blog.mozilla.org/webrtc/channelcount-microphone-constraint/
  with stereo audio (channelCount), no AGC (autoGainControl),noise suppression (noiseSuppression) and AEC (echoCancellation)
  - Settings should also allow for separate outputs for mic and audio streams (if possible)

  - Move MIDI handling to a new class/file for simplicity
  - Allow for staring of a call from a browser variable (added basic functionality using ?room and ?joinRoom. this will be better in a multiuser situation)
    - Maybe this would work better if you just join a room. If it doesn't exist, make it, if it does then join it.

  - Add a loading screen for waiting for credentials
*/
class Tether {
    constructor() {
        mdc.ripple.MDCRipple.attachTo(document.querySelector('.mdc-button'));

        // this.configuration = {
        //   iceServers: [
        //     {
        //       urls: [
        //         'stun:stun1.l.google.com:19302',
        //         'stun:stun2.l.google.com:19302',
        //       ],
        //     },
        //     {
        //       urls: "turn:numb.viagenie.ca",
        //       credential: "6CdMbe9!S6P!V4u",
        //       username: "tether",
        //     },
        //   ],
        //   iceCandidatePoolSize: 10,
        // };

        this.configuration = null;

        // Firebase function to generate ICE config data on server side
        this.functions = firebase.functions();
        this.getICEServerConfig = this.functions.httpsCallable('getICEConfig');

        this.db = null;
        this.roomRef = null;
        this.urlRoomRef = null;
        this.joinRoomRef = null;

        this.callControls = document.querySelector('#callControls');
        this.callControlButton = document.querySelector('#callControl');
        this.callControlButtonText = this.callControlButton.querySelector('span').textContent;

        // this.midiControls = document.querySelector('#midiControls');
        this.midiControlButton = document.querySelector('#midiControl');
        this.midiControlButtonText = this.midiControlButton.querySelector('span').textContent;

        this.peerConnection = null;
        this.localVideo = document.querySelector('#localVideo');
        this.localStream = null;
        this.localAuxStream = null;
        this.remoteVideo = document.querySelector('#remoteVideo');
        this.remoteStream = null;
        this.remoteAuxStream = null;
        this.localDataChannel = null;
        this.dataChannelIsOpen = false;
        this.receiveDataChannel = null;
        this.roomDialog = null;
        this.roomId = null;
        this.currentRoom = document.querySelector('#currentRoom');

        this.copyIDButton = document.querySelector('#copyID');

        this.mediaControls = document.querySelector('#mediaControls');

        this.settingsDialog = null;
        this.settingsAction = document.getElementById("settingsButton");
        this.auxInputSelect = document.querySelector('select#auxSource');
        this.auxInputActivate = document.querySelector('#auxActivate');
        this.auxInputActive = false;
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
        this.auxMuteToggle = new mdc.iconButton.MDCIconButtonToggle(document.getElementById("audioIn"));

        this.fullscreenControl = document.querySelector('#fullscreen');
        this.fullscreenToggle = document.querySelector("#fullscreenButton");
        this.loadingAnimation = document.querySelector('.loader');

        this.init();

    }

    init() {
        let that = this;

        this.checkForRoomName();

        firebase.auth().signInAnonymously()
            .then(() => {
                that.db = firebase.firestore();
            })
            .catch((error) => {
                var errorCode = error.code;
                var errorMessage = error.message;
            });

        this.getICEServerConfig()
            .then((result) => {
                console.log(result);
                that.configuration = result.data;
            })
            .catch((error) => {
                console.log(error.code + error.message);
            });

        this.callControlButton.onclick = () => {
            if (this.callControls.style.display === "block") {
                this.callControlButtonText = "Show Call Controls";
                this.removeElement(this.callControls);
            } else {
                this.callControlButtonText = "Hide Call Controls";
                this.displayElement(this.callControls);
            }
        };

        this.midiControlButton.onclick = () => {
            if (this.midiUI.style.display === "block") {
                this.midiControlButtonText = "Show MIDI Controls";
                this.removeElement(this.midiUI);
            } else {
                this.midiControlButtonText = "Hide MIDI Controls";
                this.displayElement(this.midiUI);
            }
        }

        navigator.mediaDevices.enumerateDevices().then((deviceInfo) => { this.gotDevices(deviceInfo) }).catch((e) => { that.handleGetMediaError(e) });
        document.querySelector('#cameraBtn').onclick = () => { this.openUserMedia(); };
        document.querySelector('#hangupBtn').onclick = () => { this.hangUp(); };
        document.querySelector('#createBtn').onclick = () => { this.createRoom(); };
        document.querySelector('#joinBtn').onclick = () => { this.joinRoom(); };
        this.copyIDButton.onclick = () => { this.copyID() };
        // document.querySelector('#sendMsg').onclick = ()=>{this.sendAMessage();};
        this.roomDialog = new mdc.dialog.MDCDialog(document.querySelector('#room-dialog'));

        this.settingsDialog = new mdc.dialog.MDCDialog(document.querySelector('#settingsDialog'));
        this.settingsAction.onclick = () => {
            this.settingsDialog.open();

        }

        this.micInputSelect.onchange = () => { this.startMedia() };
        this.audioOutputSelect.onchange = () => { this.changeAudioDestination() };
        this.videoSelect.onchange = () => { this.startMedia() };

        this.auxInputSelect.onchange = () => { this.startAuxMedia() };
        // this.auxInputActivate.onchange = (action) => {
        //   console.log(this.auxInputActivate.checked);
        //   if (this.auxInputActivate.checked && !this.auxInputActive) {
        //      this.auxSourceCreate();
        //      this.auxInputActive = true;
        //    } else {
        //      this.auxSourceDestroy();
        //      this.auxInputActive = false;
        //    }
        // }

        this.micMuteToggle.listen('click', () => {
            this.micControlAction(this.micMuteToggle.on);
        });

        this.videoMuteToggle.listen('click', () => {
            this.videoControlAction(this.videoMuteToggle.on);
        });

        this.auxMuteToggle.listen('click', () => {
            this.auxControlAction(this.auxMuteToggle.on);
        });

        this.fullscreenToggle.onclick = () => {
            this.fullscreenAction();
        };

        this.activateMidiAction.onclick = () => {
            this.removeElement(this.midiInitButton);
            that.displayElement(that.midiUI);
            // Tone.context.resume();
            that.initMidi();
            that.showElement(that.midiControlButton);
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
                if (that.midiInputMenu.value != null) {
                    that.currentMIDIInput = WebMidi.getInputById(that.midiInputMenu.value);
                    console.log(that.currentMIDIInput);

                    if (that.currentMIDIInput) {
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

        this.midiOutputMenu.onchange = () => {
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

    auxControlAction(status) {
        this.localAuxStream.getAudioTracks()[0].enabled = status;
    }

    checkForRoomName() {
        let urlParams = new URLSearchParams(window.location.search);
        this.urlRoomRef = urlParams.get('room');
        this.joinRoomRef = urlParams.get('joinRoom');
    }

    async createRoom() {
        let that = this;

        document.querySelector('#createBtn').disabled = true;
        document.querySelector('#joinBtn').disabled = true;

        if (this.urlRoomRef) {
            this.roomRef = await this.db.collection('rooms').doc(this.urlRoomRef);
        } else {
            this.roomRef = await this.db.collection('rooms').doc(this.generateId());
        }

        console.log('Create PeerConnection with configuration: ', that.configuration);
        this.peerConnection = new RTCPeerConnection(that.configuration);

        this.registerPeerConnectionListeners();

        this.localStream.getTracks().forEach(track => {
            that.peerConnection.addTrack(track, that.localStream);
        });

        // this.localAuxStream.getTracks().forEach(track => {
        //   that.peerConnection.addTrack(track, that.localAuxStream);
        // });

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
        this.currentRoom.innerText = `Current room is ${this.roomRef.id} - You are the caller!`;
        this.showElement(this.copyIDButton);
        this.showElement(this.currentRoom);
        this.displayElement(this.midiInitButton);

        // Code for creating a room above

        this.peerConnection.addEventListener('track', event => {
            console.log('Got remote track:', event.streams[0]);
            event.streams[0].getTracks().forEach(track => {
                console.log('Add a track to the remoteStream:', track);
                that.remoteStream.addTrack(track);
            });
            that.showElement(that.remoteVideo);
            that.showElement(that.fullscreenControl);
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
        for (var i = 0; i < length; i++) {
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

        setTimeout(() => {
            this.notify.innerHTML = '';
            this.notify.style.visibility = "hidden";
        }, 2000);
    }

    /**
    */
    async joinRoom() {
        let that = this;
        document.querySelector('#createBtn').disabled = true;
        document.querySelector('#joinBtn').disabled = true;

        document.querySelector('#confirmJoinBtn').
            addEventListener('click', async () => {
                that.roomId = document.querySelector('#room-id').value;
                console.log('Join room: ', that.roomId);
                this.currentRoom.innerText = `Current room is ${that.roomId} - You are the callee!`;
                that.displayElement(that.currentRoom);
                that.displayElement(that.midiInitButton);
                await that.joinRoomById(that.roomId);
            }, { once: true });

        if (this.joinRoomRef) {
            this.roomId = this.joinRoomRef;
            console.log('Join room: ', that.roomId);
            this.currentRoom.innerText = `Current room is ${that.roomId} - You are the callee!`;
            that.displayElement(that.currentRoom);
            that.displayElement(that.midiInitButton);
            await that.joinRoomById(that.roomId);
        } else {
            this.roomDialog.open();
        }

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
                that.showElement(this.remoteVideo);
                that.showElement(that.fullscreenControl);
            });

            // Handle MIDI over the DataChannel
            this.peerConnection.ondatachannel = event => {
                console.log("caller send channel: ", event.channel);
                that.localDataChannel = event.channel;
                that.localDataChannel.onmessage = event => { that.handleMIDIMessage(event.data); };
                that.localDataChannel.onopen = () => { that.dataChannelIsOpen = true; };
                that.localDataChannel.onclose = () => { that.dataChannelIsOpen = false; };
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
        this.showElement(this.localVideo);
        this.showElement(this.mediaControls);
        this.showElement(this.callControlButton);
        this.remoteStream = new MediaStream();
        this.remoteVideo.srcObject = this.remoteStream;

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
            audio: {
                channelCount: { ideal: 4, min: 1 },
                deviceId: micSource ? { exact: micSource } : undefined
            },
            video: {
                deviceId: videoSource ? { exact: videoSource } : undefined,
                height: { min: 720 },
                width: { min: 1280 },
            }
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

    async startAuxMedia() {
        let that = this;

        if (this.auxStream) {
            this.auxStream.getTracks().forEach(track => {
                track.stop();
            });
        }
        let auxSource = this.auxInputSelect.value;
        let constraints = {
            audio: {
                channelCount: { ideal: 2, min: 1 },
                deviceId: auxSource ? { exact: auxSource } : undefined
            },
            video: false
        };
        this.auxStream = await navigator.mediaDevices.getUserMedia(constraints)
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

    showElement(element) {
        element.style.visibility = "visible";
    }
    hideElement(element) {
        element.style.visibility = "hidden";
    }
    displayElement(element) {
        element.style.display = "block";
    }
    removeElement(element) {
        element.style.display = "none";
    }

    fullscreenAction(status) {
        /*
          Maybe allow for settings mouse over in upper right corner, may have to add it to the remoteVideo div
        */

        if (
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
        ) {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        } else {
            this.showElement(this.remoteVideo);

            let element = this.remoteVideo;
            if (element.requestFullscreen) {
                element.requestFullscreen();
            } else if (element.mozRequestFullScreen) {
                element.mozRequestFullScreen();
            } else if (element.webkitRequestFullscreen) {
                element.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
            } else if (element.msRequestFullscreen) {
                element.msRequestFullscreen();
            }
        }
    }

    /**
    */
    async hangUp(e) {
        let that = this;

        this.tracks = document.querySelector('#localVideo').srcObject.getTracks();
        this.tracks.forEach(track => {
            track.stop();
        });

        this.hideElement(this.mediaControls);
        this.hideElement(this.fullscreenControl);
        this.hideElement(this.localVideo);
        this.hideElement(this.remoteVideo);
        this.hideElement(this.midiControlButton);
        this.hideElement(this.callControlButton);

        if (that.remoteStream) {
            that.remoteStream.getTracks().forEach(track => track.stop());
        }

        if (that.peerConnection) {
            that.peerConnection.close();
        }

        this.localVideo.srcObject = null;
        this.remoteVideo.srcObject = null;
        document.querySelector('#cameraBtn').disabled = false;
        document.querySelector('#joinBtn').disabled = true;
        document.querySelector('#createBtn').disabled = true;
        document.querySelector('#hangupBtn').disabled = true;
        this.currentRoom.innerText = '';
        this.hideElement(this.copyIDButton);

        this.removeElement(this.midiInitButton);
        this.removeElement(this.midiUI);

        this.showElement(this.loadingAnimation);

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
        const that = this;
        const audioDestination = this.audioOutputSelect.value;
        this.attachSinkId(that.localVideo, audioDestination);
    }

    auxSourceCreate() {

    }

    auxSourceDestroy() {

    }

    initMidi() {
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
            WebMidi.addListener("connected", function (e) {
                // that.fillInputs();
                // that.fillOutputs();
            });

            // Reacting when a device becomes unavailable
            WebMidi.addListener("disconnected", function (e) {
                // that.fillInputs();
                // that.fillOutputs();
            });

            that.fillMIDIInputs();
            that.fillMIDIOutputs();
        });

    }

    fillMIDIInputs() {
        let that = this;

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
            let statusByte = message.data[0];
            let dataArray = Object.values(message.data);
            this.currentMIDIOutput.send(statusByte, dataArray.slice(1));
        }
    }

    sendMIDIMessage(message) {
        if (this.dataChannelIsOpen) {
            this.localDataChannel.send(JSON.stringify(message));
        }
    }

    sendAMessage() {
        this.localDataChannel.send("Hello");
    }

} // End of Tether Class

window.onload = () => {
    window.app = new Tether();
}
