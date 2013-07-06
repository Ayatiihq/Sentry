require('sugar');
var acquire = require('acquire')
  , config = acquire('config')
  , IFrameExploder = acquire('iframe-exploder')
  , webdriver = require('selenium-webdriverjs');

// we should be using chrome or firefox here for sure, just to handle random javascript nonsense
var CAPABILITIES = { browserName: 'firefox', seleniumProtocol: 'WebDriver'};

var iframeTester = function () {
  var self = this;
  //this.weburl = "http://gordallott.com/test/test.html";
  //this.weburl = "http://www.newtvworld.com/India-Live-Tv-Channels/Channel-One-live-streaming.html"
  this.weburl = "http://www.masteetv.com/zee_tv_live_online_free_channel_streaming_watch_zee_tv_HD.php"
  this.client = new webdriver.Builder().usingServer(config.SELENIUM_HUB_ADDRESS)
                             .withCapabilities(CAPABILITIES).build();
  this.client.manage().timeouts().implicitlyWait(10000); // waits 10000ms before erroring, gives pages enough time to load
  this.foundobjs = [];

  this.client.get(this.weburl).then(function () {
    // wait for the request for the specified page to be resolved on the selenium node

    self.iframe = new IFrameExploder(self.client);
    self.iframe.debug = true; // don't do this in production, too noisy

    self.iframe.on('finished', function iframeFinished() { // when we are finished it's safe to use self.client again
      self.client.quit();
      console.log('iframe selector finished');
      console.log('found ' + self.foundobjs.length + ' items of interest');

      self.foundobjs.each(function (val) {
        console.log('possible infringement at ' + val.uri);
        console.log(val.toString());
        var depth = 1;
        console.log('parents: ')
        val.parenturls.each(function (parenturl) {
          console.log('-'.repeat(depth) + '> ' + parenturl);
          depth++;
        });
      });
    });

    self.iframe.on('found-source', function foundSource(uri, parenturls, $, source) {
      // uri is the uri of the current iframe
      // parenturls is a list of parents, from closest parent iframe to root iframe
      // $ is a cheerio object from the source
      // source is a text representation of how the browser views the current DOM, it may be missing various things
      // or have additional things added. it is not the same as just wgetting the html file. 


      // we look for a few generic tag names, we should do more in production, regex over the entire source for example.
      $('object').each(function onObj() { this.parenturls = parenturls; this.uri = uri; self.foundobjs.push(this); });
      $('embed').each(function onEmd() { this.parenturls = parenturls; this.uri = uri; self.foundobjs.push(this); });
      $('param').each(function onFlashVars() {
        if ($(this).attr('name').toLowerCase().trim() === 'flashvars') {
          this.parenturls = parenturls;
          this.uri = uri;
          self.foundobjs.push(this);
        }
      });
    });

    // call to start the whole process
    self.iframe.search();
  });

};

var tester = new iframeTester();
