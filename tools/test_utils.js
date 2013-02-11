var i = require('./common/infringements.js');

var uris = [
  'http://example.com/bar/foo.xml?foo=bar&hello=world&hello=mars',
  'http://www.example.com/bar/foo.xml?hello=world&hello=mars&foo=bar',
  'http://example.com/bar/foo.xml?hello=mars&foo=bar&hello=world',
  'http://example.com:80/bar/foo.xml?hello=mars&foo=bar&hello=world'

];

uris.forEach(function(uri) {
  console.log(i.normalizeURI(uri));
});