// Minimal TextDecoder polyfill for jsc (UTF-8 + latin1 fallback), test-only.
function TextDecoder(enc) {
  this.encoding = (enc || 'utf-8').toLowerCase();
}
TextDecoder.prototype.decode = function (bytes) {
  var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (this.encoding.indexOf('utf-8') !== -1 || this.encoding.indexOf('utf8') !== -1) {
    var out = '', i = 0;
    while (i < arr.length) {
      var b0 = arr[i];
      if (b0 < 0x80) { out += String.fromCharCode(b0); i += 1; }
      else if ((b0 & 0xE0) === 0xC0 && i + 1 < arr.length) {
        out += String.fromCharCode(((b0 & 0x1F) << 6) | (arr[i + 1] & 0x3F)); i += 2;
      } else if ((b0 & 0xF0) === 0xE0 && i + 2 < arr.length) {
        out += String.fromCharCode(((b0 & 0x0F) << 12) | ((arr[i + 1] & 0x3F) << 6) | (arr[i + 2] & 0x3F)); i += 3;
      } else if ((b0 & 0xF8) === 0xF0 && i + 3 < arr.length) {
        var cp = ((b0 & 0x07) << 18) | ((arr[i + 1] & 0x3F) << 12) | ((arr[i + 2] & 0x3F) << 6) | (arr[i + 3] & 0x3F);
        out += String.fromCodePoint(cp); i += 4;
      } else { out += String.fromCharCode(b0); i += 1; }
    }
    return out;
  }
  var s = '';
  for (var k = 0; k < arr.length; k++) s += String.fromCharCode(arr[k]);
  return s;
};
