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

//utilities.notify('hello');

utilities.request('http://torcache.net/torrent/A961BC2B93A2304880F919E304424A14400BA8A2.torrent?title=[kat.ph]gangster.squad.2013.dvdrip.xvid.maxspeed',
                  {  }, 
                  function(err, res, body) {
  console.log('requestURL', err ? err : body);
});

setTimeout(process.exit, 5 * 1000);