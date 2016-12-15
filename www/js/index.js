(function() {
  'use strict';
  
  console.log = function (message) {
    if (typeof message == 'object') {
      $('#debug').prepend($('<div>').html(JSON.stringify(message)))
    } else {
      $('#debug').prepend($('<div>').html(message))
    }
  };
  
  console.error = function (message) {
    if (typeof message == 'object') {
      $('#debug').prepend($('<div style="color: red">').html(JSON.stringify(message)))
    } else {
      $('#debug').prepend($('<div style="color: red">').html(message))
    }
  };
  
  console.err = console.error;

  window.onerror = function (err) {
    console.error(err);
  }
  
  var SAMPLE_RATE = 16000;
  
  function blobToBase64(blob, callback) {
    var reader = new FileReader();
    reader.onloadend = function() {
      callback(null, reader.result);
    }
    
    reader.readAsDataURL(blob); 
  }
  
  $.widget("custom.client", {
    options: {
      reconnectTimeout: 3000,
      port: 443,
      host: 'demo.sanelukone.fi'
    },
    
    _create : function() {
      this._pendingMessages = [];
      this._pendingBinaries = [];
      this._state = "DISCONNECTED";
    },
    
    connect: function () {
      this._connect();
    },
    
    sendClip: function(data) {
      this._sendBinary(data);
    },
    
    sendMessage: function(type, data) {
      this._sendMessage(type, data);
    },
    
    _connect: function () {
      this._state = 'CONNECTING';
      console.log("Connecting...");
      
      this._webSocket = this._createWebSocket();
      if (!this._webSocket) {
        console.log("Could not create websocket");
        return;
      } 
      
      switch (this._webSocket.readyState) {
        case this._webSocket.CONNECTING:
          this._webSocket.onopen = $.proxy(this._onWebSocketOpen, this);
        break;
        case this._webSocket.OPEN:
          this._onWebSocketOpen();
        break;
        default:
          this._reconnect();
        break;
      }
      
      this._webSocket.onmessage = $.proxy(this._onWebSocketMessage, this);
      this._webSocket.onclose = $.proxy(this._onWebSocketClose, this);
      this._webSocket.onerror = $.proxy(this._onWebSocketError, this);
    },
    
    _reconnect: function () {
      console.log("Reconnecting...");

      if (this._reconnectTimeout) {
        clearTimeout(this._reconnectTimeout);
      }
      
      if (!this._webSocket || this._webSocket.readyState !== this._webSocket.CONNECTING) {
        this._connect();
      }
      
      this._reconnectTimeout = setTimeout($.proxy(function () {
        console.log("timeout socket state: " + this._webSocket.readyState);
        
        if (this._webSocket.readyState === this._webSocket.CLOSED) {
          this._reconnect();
        }
      }, this), this.options.reconnectTimeout);
    },

    _createWebSocket: function () {
      var url = 'wss://' + this.options.host + ':' + this.options.port;
      console.log("Connecting to " + url);
      
      var socket = null;
      if ((typeof window.WebSocket) !== 'undefined') {
        socket = new WebSocket(url);
      } else if ((typeof window.MozWebSocket) !== 'undefined') {
        socket = new MozWebSocket(url);
      }
      
      socket.binaryType = 'arraybuffer';
      
      return socket;
    },
    
    _sendMessage: function (type, data) {
      if (this._state === 'CONNECTED') {
        this._webSocket.send(JSON.stringify({
          type: type,
          data: data
        }));
      } else {
        this._pendingMessages.push({
          type: type,
          data: data
        });
      }
    },
    
    _sendBinary: function (data) {
      if (this._state === 'CONNECTED') {
        this._sendBinaryData(data);
      } else {
        this._pendingBinaries.push(data);
      }
    },
    
    _onWebSocketOpen: function (event) {
      while (this._pendingMessages.length) {
        var pendingMessage = this._pendingMessages.shift();
        this._webSocket.send(JSON.stringify({
          type: pendingMessage.type,
          data: pendingMessage.data
        }));
      }

      while (this._pendingBinaries.length) {
        var pendingBinary = this._pendingBinaries.shift();
        this._sendBinaryData(pendingBinary);
      }

      this._state = 'CONNECTED';
      console.log("Connected");
    },
    
    _sendBinaryData: function (data) {
      this._webSocket.send(data);
    },
    
    _onWebSocketMessage: function (event) {
      var message = JSON.parse(event.data);
      
      if (message && message.type) {
        this.element.trigger(message.type, message.data); 
      }
    },
    
    _onWebSocketClose: function (event) {
      console.log("Socket closed");
      this._reconnect();
    },
    
    _onWebSocketError: function (event) {
      console.log("Socket error");
      this._reconnect();
    }
  });
  
  $.widget("custom.fileStore", {
    
    _create : function() {
    },
    
    removeClip: function (clip, callback) {
      clip.remove(function () {
        if (callback) {
          callback(null);
        }
      }, function (err) {
        if (callback) {
          callback(err);
        }
      }, function() {
        if (callback) {
          callback("File does not exist");
        }
      });
    },
    
    removeAllClips: function () {
      this._readClips(null, function (err, entries) {
        for (var i = 0, l = entries.length; i < l; i++) {
          this.removeClip(entries[i]);
        }
      }.bind(this));
    },
    
    nextClip: function (sessionId, callback) {
      this._readClips(sessionId, function (err, entries) {
        callback(err, entries && entries.length ? entries[0] : null);
      }.bind(this));
    },
    
    nextSession: function (callback) {
      this._readClips(null, function (err, entries) {
        if (err) {
          callback(err);
        } else {
          if (entries && entries.length) {
            callback(null, entries[0].name.split('_')[0]);
          } else {
            callback(null, null);
          }
        }
      }.bind(this));
    },
    
    addClip: function (sessionId, blob) {
      var filename = sessionId + '_' + (String) (new Date().getTime()) + '.clip';
      window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function(dir) {
        dir.getFile(filename, { create: true }, function(file) {
          file.createWriter(function(fileWriter) {
            fileWriter.write(blob);
          });
        });
      });
    },
    
    _readClips: function(sessionId, callback) {
      this._readFiles(function (err, entries) {
        var clips = [];
        for (var i = 0, l = entries.length; i < l; i++) {
          var entry = entries[i];
          var entryName = entry.name;
          if (entryName && (sessionId == null || entryName.startsWith(sessionId)) && entryName.endsWith('.clip')) {
            clips.push(entry);
          }
        }
        
        callback(err, clips);
      });
    },
    
    _readFiles: function(callback) {
      window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function(dir) {
        var fileReader = dir.createReader();
        fileReader.readEntries(function (entries) {
          callback(null, entries);
        }, function (err) {
          callback(err);
        });
      });
    }
    
  });
  
  $.widget("custom.encoder", {
    
    toWave: function (data, sampleRate, channels) {
      var encoder = new WavAudioEncoder(sampleRate, channels);
      encoder.encode([data]);
      return encoder.finish("audio/wav");
    }
    
  });
  
  $.widget("custom.sanelukone", {
  
    _create : function() {
      this._recordSessionId = null;
      this._transmitSessionId = null;
      this._transmitClip = null;
      this._stop = false;
      
      this.element.client();
      this.element.fileStore();
      this.element.encoder();
      
      this.element.on('deviceready', this._onDeviceReady.bind(this));
    },
    
    _onDeviceReady: function () {
      this.element.fileStore('removeAllClips');
      
      this.element.client('connect');
      this.element.client('sendMessage', 'system:hello');

      this.element.on('transmit:clip-transmitted', this._onClipTransmitted.bind(this));
    
      window.addEventListener("audioinput", this._onAudioInput.bind(this), false);
      window.addEventListener("audioinputerror", this._onAudioInputError.bind(this), false);

      this.element.find('#record-button').click(this._onRecordButtonClick.bind(this));
      this.element.find('#stop-button').click(this._onStopButtonClick.bind(this));//
      this._transmitNextClip();
    },
    
    _onClipTransmitted: function () {
      this.element.fileStore('removeClip', this._transmitClip, function () {
        this._transmitNextClip();
      }.bind(this));
    },
    
    _transmitNextClip: function () {
      setTimeout(function () {
        this._getTransmitSessionId(function (sessionErr, transmitSessionId) {
          if (sessionErr) {
            console.error("Session error: " + sessionErr);
          } else {
            if (transmitSessionId == null) {
              // No untransmitted sessions found
              if (this._transmitSessionId != null && this._recordSessionId == null) {
                console.log("Stopped transmitting");
                // Was transmitting, but not the current record session so there can be no more data for this session
                this.element.client('sendMessage', 'transmit:end', {
                  sessionId: this._transmitSessionId
                });
                
                this._transmitSessionId = null;
              }
              
              this._transmitNextClip();
            } else {
              if (this._transmitSessionId == null) {
                console.log("Started transmitting");
                // Was not transmitting, but new session found, so we should start new transit session
                
                this.element.client('sendMessage', 'transmit:start', {
                  sessionId: transmitSessionId
                });
                
                this._transmitSessionId = transmitSessionId;
              }
              
              this.element.fileStore('nextClip', this._transmitSessionId, function (err, clipEntry) {
                if (err) {
                  console.error(err);
                } else {
                  if (clipEntry != null) {
                    console.log("Going to transmit clip");
                    
                    this._transmitClip = clipEntry;
                    clipEntry.file(function (clip) {
                      var reader = new FileReader();
                      reader.onloadend = function() {
                        this.element.client('sendClip', new Uint8Array(reader.result));
                      }.bind(this);
                      
                      reader.readAsArrayBuffer(clip);
                    }.bind(this));
                  } else {
                    this._transmitNextClip();
                  }
                }
              }.bind(this));
            }
          }
        }.bind(this));
      }.bind(this), 300);
    },
    
    _getTransmitSessionId: function (callback) {
      this.element.fileStore('nextSession', function (err, sessionId) {
        callback(err, sessionId);
      });
    },
    
    _onAudioInput: function (event) {
      var data = event.data;
      var waveBlob = this.element.encoder('toWave', data, SAMPLE_RATE, 1);
          
      this.element.fileStore('addClip', this._recordSessionId, waveBlob);
      
      if (this._stop) {
        audioinput.stop();
        
        this.element.client('sendMessage', 'record:stop', {
          sessionId: this._recordSessionId
        });
        
        this._recordSessionId = null;
        
        console.log("Recoding stopped");
        console.log("--------------------");
      }
    },
    
    _onAudioInputError: function (error) {
      alert(JSON.stringify(error));      
    },
    
    _onRecordButtonClick: function () {
      this._recordSessionId = uuid.v4();
      this._stop = false;
      
      try {
        var sourceType = audioinput.UNPROCESSED;
        audioinput.start({
          bufferSize: 1024 * 20,
          sampleRate: SAMPLE_RATE,
          channels: audioinput.CHANNELS.MONO,
          format: audioinput.FORMAT.PCM_16BIT,
          normalize: true,
          streamToWebAudio: false,
          audioSourceType: sourceType
        });
      } catch (e) {
        console.error(e);
      }
      
      this.element.client('sendMessage', 'record:start', {
        sessionId: this._recordSessionId
      });
      
      console.log("Recoding...");
    },
    
    _onStopButtonClick: function () {
      this._stop = true;
    }
    
  });
  
  $(document).sanelukone();

}).call(this);