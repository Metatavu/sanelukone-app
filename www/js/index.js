(function() {
  'use strict';
  
  console.log = function (message) {
    if (typeof message == 'object') {
      $('#debug').append($('<div>').html(JSON.stringify(message)))
    } else {
      $('#debug').append($('<div>').html(message))
    }
  };
  
  console.err = function (message) {
    if (typeof message == 'object') {
      $('#debug').append($('<div style="color: red">').html(JSON.stringify(message)))
    } else {
      $('#debug').append($('<div style="color: red">').html(message))
    }
  };

  window.onerror = function (err) {
    console.err(err);
  }
  
  $.widget("custom.client", {
    options: {
      reconnectTimeout: 3000,
      clientId: null,
      port: 8000,
      host: '192.168.1.17', // '192.168.100.12'
    },
    
    _create : function() {
      this._pendingMessages = [];
      this._pendingBinaries = [];
      this._state = "DISCONNECTED";
    },
    
    connect: function (sessionId) {
      this._connect(sessionId);
    },
    
    sendClip: function(data) {
      this._sendBinary(data);
    },
    
    sendMessage: function(type, data) {
      this._sendMessage(type, data);
    },
    
    _connect: function (sessionId) {
      this._state = 'CONNECTING';
      console.log("Connecting...");
      
      this._webSocket = this._createWebSocket(sessionId);
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

    _createWebSocket: function (sessionId) {
      var url = 'ws://' + this.options.host + ':' + this.options.port;
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
      var binaryArray = new Uint8Array(data.length);
      
      for (var i = 0, l = data.length; i < l; i++) {
        binaryArray[i] = data[i];
      }

      this._webSocket.send(binaryArray.buffer);
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
    
    removeFile: function (file, callback) {
      file.remove(function () {
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
    
    nextClip: function (callback) {
      this._readClips(function (err, entries) {
        callback(err, entries && entries.length ? entries[0] : null);
      }.bind(this));
    },
    
    addClip: function (data) {
      var filename = (String) (new Date().getTime()) + '.clip';
      window.resolveLocalFileSystemURL(cordova.file.dataDirectory, function(dir) {
        dir.getFile(filename, { create: true }, function(file) {
          file.createWriter(function(fileWriter) {
            var blob = new Blob(data);
            fileWriter.write(blob);
          });
        });
      });
    },
    
    _readClips: function(callback) {
      this._readFiles(function (err, entries) {
        var clips = [];
        for (var i = 0, l = entries.length; i < l; i++) {
          var entry = entries[i];
          if (entry.name && entry.name.endsWith('.clip')) {
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
  
  $.widget("custom.sanelukone", {
  
    _create : function() {
      console.log("Init");

      this._processingClip = null;
      
      this.element.client();
      this.element.fileStore();
      
      this.element.on('deviceready', this._onDeviceReady.bind(this));
    },
    
    _onDeviceReady: function () {
      this.element.client('connect');
      this.element.client('sendMessage', 'system:hello');

      this.element.on('clip:processed', this._onClipProcessed.bind(this));
    
      window.addEventListener("audioinput", this._onAudioInput.bind(this), false);
      window.addEventListener("audioinputerror", this._onAudioInputError.bind(this), false);

      this.element.find('#record-button').click(this._onRecordButtonClick.bind(this));
      this.element.find('#stop-button').click(this._onStopButtonClick.bind(this));//
      this._processNextClip();
    },
    
    _onClipProcessed: function () {
      console.log("Processed");
      this._processNextClip();
    },
    
    _processNextClip: function () {
      setTimeout(function () {
        this.element.fileStore('nextClip', function (err, clipEntry) {
          if (err) {
            console.err(err);
          } else {
            if (clipEntry != null) {
              console.log("Going to process clip");
              
              this._processingClip = clipEntry;
              this.element.client('sendClip', data);
            } else {
              this._processNextClip();
            }
          }
        }.bind(this));
      }.bind(this), 300);
    },
    
    _onAudioInput: function (event) {
      var data = event.data;
      this.element.fileStore('addClip', data);
    },
    
    _onAudioInputError: function (error) {
      alert(JSON.stringify(error));      
    },
    
    _onRecordButtonClick: function () {
      console.log("Start recording");
      
      try {
        var sourceType = device.platform == 'Android' ? audioinput.VOICE_RECOGNITION : audioinput.UNPROCESSED;
        audioinput.start({
          bufferSize: 8192,
          channels: audioinput.CHANNELS.MONO,
          format: audioinput.FORMAT.PCM_16BIT,
          normalize: false,
          streamToWebAudio: false,
          audioSourceType: sourceType
        });
      } catch (e) {
        console.err(e);
      }
      
      console.log("Recoding...");// 
    },
    
    _onStopButtonClick: function () {
      audioinput.stop();
      console.log("Recoding stopped");
    }
    
  });
  
  $(document).sanelukone();

}).call(this);