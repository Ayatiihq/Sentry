var acquire = require('acquire')
  , utilities = acquire('utilities')

var uris = [
  'http://example.com/bar/foo.xml?foo=bar&hello=world&hello=mars',
  'http://www.example.com/bar/foo.xml?hello=world&hello=mars&foo=bar',
  'http://example.com/bar/foo.xml?hello=mars&foo=bar&hello=world',
  'http://example.com:80/bar/foo.xml?hello=mars&foo=bar&hello=world',
  'http://eXAMple.com:80/bar/foo.xml?hello=mars&foo=bar&hello=world',
  'http://eXAMple.com:80/bar/./foo.xml?hello=mars&foo=bar&hello=world',
  'http://eXAMple.com:80/bar/./foo.xml?&hello=mars&&foo=bar&&hello=world'
];

uris.forEach(function(uri) {
  console.log(utilities.normalizeURI(uri));
});

console.log('');

uris.forEach(function(uri) {
  console.log(utilities.genURIKey(uri));
});

console.log('');

uris.forEach(function(uri) {
  console.log(utilities.genURIKey(uri, 'google'));
});

console.log('\nVersion:');
utilities.getVersion(console.log);

utilities.notify('hello');