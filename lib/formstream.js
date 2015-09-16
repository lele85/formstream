/**!
 * formstream - lib/formstream.js
 *
 * Copyright(c) 2012 - 2014 fengmk2 <fengmk2@gmail.com>
 * MIT Licensed
 *
 * Data format:
 *

--FormStreamBoundary1349886663601\r\n
Content-Disposition: form-data; name="foo"\r\n
\r\n
<FIELD-CONTENT>\r\n
--FormStreamBoundary1349886663601\r\n
Content-Disposition: form-data; name="file"; filename="formstream.test.js"\r\n
Content-Type: application/javascript\r\n
\r\n
<FILE-CONTENT>\r\n
--FormStreamBoundary1349886663601\r\n
Content-Disposition: form-data; name="pic"; filename="fawave.png"\r\n
Content-Type: image/png\r\n
\r\n
<IMAGE-CONTENT>\r\n
--FormStreamBoundary1349886663601--

 *
 */

"use strict";

/**
 * Module dependencies.
 */

require('buffer-concat');
var CombinedStream = require("combined-stream");
var streamifier = require("streamifier");
var Stream = require('stream');
var parseStream = require('pause-stream');
var util = require('util');
var mime = require('mime');
var path = require('path');
var fs = require('fs');
var destroy = require('destroy');

var PADDING = '--';
var NEW_LINE = '\r\n';
var NEW_LINE_BUFFER = new Buffer(NEW_LINE);

function FormStream() {
  if (!(this instanceof FormStream)) {
    return new FormStream();
  }

  this._boundary = this._generateBoundary();
  this._streams = [];
  this._buffers = [];
  this._endData = new Buffer(PADDING + this._boundary + PADDING + NEW_LINE);
  this._contentLength = 0;
  this._isAllStreamSizeKnown = true;
  this._knownStreamSize = 0;
}

module.exports = FormStream;

FormStream.prototype._generateBoundary = function() {
  // https://github.com/felixge/node-form-data/blob/master/lib/form_data.js#L162
  // This generates a 50 character boundary similar to those used by Firefox.
  // They are optimized for boyer-moore parsing.
  var boundary = '--------------------------';
  for (var i = 0; i < 24; i++) {
    boundary += Math.floor(Math.random() * 10).toString(16);
  }

  return boundary;
};

FormStream.prototype.setTotalStreamSize = function (size) {
  // this method should not make any sense if the length of each stream is known.
  if (this._isAllStreamSizeKnown) {
    return this;
  }

  size = size || 0;

  for (var i = 0; i < this._streams.length; i++) {
    size += this._streams[i][0].length;
    size += NEW_LINE_BUFFER.length; // stream field end pedding size
  }

  this._knownStreamSize = size;
  this._isAllStreamSizeKnown = true;

  return this;
};

FormStream.prototype.headers = function (options) {
  var headers = {
    'Content-Type': 'multipart/form-data; boundary=' + this._boundary
  };

  // calculate total stream size
  this._contentLength += this._knownStreamSize;

  // calculate length of end padding
  this._contentLength += this._endData.length;

  if (this._isAllStreamSizeKnown) {
    headers['Content-Length'] = String(this._contentLength);
  }

  if (options) {
    for (var k in options) {
      headers[k] = options[k];
    }
  }

  return headers;
};

FormStream.prototype.file = function (name, filepath, filename, filesize) {
  var mimeType = mime.lookup(filepath);

  if (typeof filename === 'number' && !filesize) {
    filesize = filename;
    filename = path.basename(filepath);
  } else if (!filename) {
    filename = path.basename(filepath);
  }

  var stream = fs.createReadStream(filepath);

  return this.stream(name, stream, filename, mimeType, filesize);
};

/**
 * Add a form field
 * @param  {String} name field name
 * @param  {String|Buffer} value field value
 * @return {this}
 */
FormStream.prototype.field = function (name, value) {
  if (!Buffer.isBuffer(value)) {
    // field(String, Number)
    // https://github.com/qiniu/nodejs-sdk/issues/123
    if (typeof value === 'number') {
      value = String(value);
    }
    value = new Buffer(value);
  }
  return this.buffer(name, value);
};

FormStream.prototype.stream = function (name, stream, filename, mimeType, size) {
  if (typeof mimeType === 'number' && !size) {
    size = mimeType;
    mimeType = mime.lookup(filename);
  } else if (!mimeType) {
    mimeType = mime.lookup(filename);
  }

  var leading = this._leading({ name: name, filename: filename }, mimeType);


  this._streams.push([leading, stream]);

  // if the size of this stream is known, plus the total content-length;
  // otherwise, content-length is unknown.
  if (typeof size === 'number') {
    this._knownStreamSize += leading.length;
    this._knownStreamSize += size;
    this._knownStreamSize += NEW_LINE_BUFFER.length;
  } else {
    this._isAllStreamSizeKnown = false;
  }

  return this;
};

FormStream.prototype.buffer = function (name, buffer, filename, mimeType) {
  if (filename && !mimeType) {
    mimeType = mime.lookup(filename);
  }

  var disposition = { name: name };
  if (filename) {
    disposition.filename = filename;
  }

  var leading = this._leading(disposition, mimeType);

  this._buffers.push([leading, buffer]);

  // plus buffer length to total content-length
  this._contentLength += leading.length;
  this._contentLength += buffer.length;
  this._contentLength += NEW_LINE_BUFFER.length;

  return this;
};

FormStream.prototype._leading = function (disposition, type) {
  var leading = [PADDING + this._boundary];

  var disps = [];

  if (disposition) {
    for (var k in disposition) {
      disps.push(k + '="' + disposition[k] + '"');
    }
  }

  leading.push('Content-Disposition: form-data; ' + disps.join('; '));

  if (type) {
    leading.push('Content-Type: ' + type);
  }

  leading.push('');
  leading.push('');

  return new Buffer(leading.join(NEW_LINE));
};


FormStream.prototype.getStream = function () {
  var streams = [];
  var combined = CombinedStream.create();
  this._buffers.forEach(function(buffer) {
    combined.append(streamifier.createReadStream(buffer[0]));
    combined.append(streamifier.createReadStream(buffer[1]));
    combined.append(streamifier.createReadStream(NEW_LINE_BUFFER));
  });

  this._streams.forEach(function(stream) {
    combined.append(streamifier.createReadStream(stream[0]));
    combined.append(stream[1]);
    combined.append(streamifier.createReadStream(NEW_LINE_BUFFER));
  });
  combined.append(streamifier.createReadStream(this._endData));
  return combined;
};
