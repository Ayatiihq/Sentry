var acquire = require('acquire')
  , fs = require('fs')
  , utilities = acquire('utilities')

if (process.argv[2] === 'requestStream') {
  var url = process.argv[3];
  var out = fs.createWriteStream(process.argv[4]);

  utilities.requestStream(url, {}, function(err, req, res, stream) {
    if (err)
      return console.warn(err);

    stream.pipe(out);

    stream.on('end', function() {
      process.exit();
    });
  });

  return;
}

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

utilities.request('http://www.index-of-mp3s.com/download/lagu/bd076ea5/kanye-west-i-am-god/',
                  { followRedirects: true }, 
                  function(err, res, body) {
  console.log('requestURL', err ? err : body);
});

setTimeout(process.exit, 5 * 1000);